import { LatLng, Order, Driver, OrderStatus, OrderStatusHistory, MatchingProposal } from './types';
import { getHaversineDistance } from './optimizationEngine';

export class DispatchEngine {
  public orders = new Map<string, Order>();
  public drivers = new Map<string, Driver>();
  public activeProposals = new Map<string, MatchingProposal>();
  public history: OrderStatusHistory[] = [];
  
  // Track which drivers have already rejected a specific order to avoid infinite loops
  private rejectedDriversMap = new Map<string, Set<string>>();

  // Active timers for proposals so we can clear them when accepted/declined
  private proposalTimers = new Map<string, NodeJS.Timeout>();

  // Event handlers to interface with Socket.io
  private onProposalCreated: (proposal: MatchingProposal, order: Order, driver: Driver) => void = () => {};
  private onProposalExpired: (orderId: string, driverId: string) => void = () => {};
  private onOrderStateChanged: (order: Order, history: OrderStatusHistory) => void = () => {};

  constructor() {
    this.seedInitialData();
  }

  public registerCallbacks(callbacks: {
    onProposalCreated: (proposal: MatchingProposal, order: Order, driver: Driver) => void;
    onProposalExpired: (orderId: string, driverId: string) => void;
    onOrderStateChanged: (order: Order, history: OrderStatusHistory) => void;
  }) {
    this.onProposalCreated = callbacks.onProposalCreated;
    this.onProposalExpired = callbacks.onProposalExpired;
    this.onOrderStateChanged = callbacks.onOrderStateChanged;
  }

  /**
   * Updates order state with robust validation and audit logging.
   */
  public updateOrderState(
    orderId: string,
    newStatus: OrderStatus,
    updatedBy: string,
    reason: string = 'System automation transition'
  ): Order | null {
    const order = this.orders.get(orderId);
    if (!order) return null;

    // Strict validation of the state transitions
    if (!this.isValidTransition(order.status, newStatus)) {
      console.warn(`[Dispatch] Invalid state transition: ${order.status} -> ${newStatus}`);
      return null;
    }

    order.status = newStatus;
    order.updatedAt = Date.now();
    this.orders.set(orderId, order);

    // Write to audit trail
    const auditRecord: OrderStatusHistory = {
      id: Math.random().toString(36).substring(2, 11),
      orderId,
      status: newStatus,
      updatedBy,
      reason,
      timestamp: Date.now()
    };
    this.history.push(auditRecord);

    // Trigger state change callback
    this.onOrderStateChanged(order, auditRecord);

    // Handle automated flow transitions
    if (newStatus === 'SEARCHING_DRIVER') {
      this.rejectedDriversMap.set(orderId, new Set<string>());
      this.initiateDriverMatching(orderId);
    } else if (newStatus === 'ACCEPTED' || newStatus === 'CANCELLED' || newStatus === 'DELIVERED') {
      this.clearProposalTimer(orderId);
      this.activeProposals.delete(orderId);
    }

    return order;
  }

  /**
   * State Machine transition integrity checker
   */
  private isValidTransition(current: OrderStatus, next: OrderStatus): boolean {
    if (current === next) return true;
    if (current === 'CANCELLED' || current === 'DELIVERED' || current === 'FAILED') return false;

    const rules: Record<OrderStatus, OrderStatus[]> = {
      DRAFT: ['PLACED', 'CANCELLED'],
      PLACED: ['SEARCHING_DRIVER', 'CANCELLED'],
      SEARCHING_DRIVER: ['ACCEPTED', 'CANCELLED', 'FAILED'],
      ACCEPTED: ['ARRIVED_AT_PICKUP', 'CANCELLED'],
      ARRIVED_AT_PICKUP: ['PICKED_UP', 'CANCELLED'],
      PICKED_UP: ['IN_TRANSIT'],
      IN_TRANSIT: ['DELIVERED', 'FAILED'],
      DELIVERED: [],
      FAILED: [],
      CANCELLED: []
    };

    return rules[current]?.includes(next) ?? false;
  }

  /**
   * Triggers the automated nearest-neighbor search for a placed order.
   */
  public initiateDriverMatching(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'SEARCHING_DRIVER') return;

    const rejections = this.rejectedDriversMap.get(orderId) || new Set<string>();

    // 1. Scan and score nearby active AVAILABLE drivers
    const availableDrivers = Array.from(this.drivers.values()).filter(
      (d) => d.status === 'AVAILABLE' && !rejections.has(d.id)
    );

    if (availableDrivers.length === 0) {
      console.log(`[Dispatch] No available drivers for order ${orderId}. Re-trying in 5 seconds...`);
      setTimeout(() => this.initiateDriverMatching(orderId), 5000);
      return;
    }

    // 2. Score drivers based on spatial Haversine distance
    const scoredDrivers = availableDrivers
      .map((d) => {
        const distance = getHaversineDistance(order.pickupLocation, d.location);
        // Base scoring logic: Lower distance = Higher score
        const score = Math.max(0, 10000 - distance);
        return { driver: d, distance, score };
      })
      .sort((a, b) => b.score - a.score); // Highest score first

    const targetMatch = scoredDrivers[0];
    if (!targetMatch) return;

    const { driver, score } = targetMatch;

    // 3. Create active proposal
    const proposalDurationMs = 30000; // 30 seconds proposal window
    const proposal: MatchingProposal = {
      orderId,
      driverId: driver.id,
      score,
      expiresAt: Date.now() + proposalDurationMs
    };

    this.activeProposals.set(orderId, proposal);
    this.onProposalCreated(proposal, order, driver);

    // 4. Set proposal timeout backup trigger
    this.clearProposalTimer(orderId);
    const timer = setTimeout(() => {
      this.handleProposalTimeout(orderId);
    }, proposalDurationMs);

    this.proposalTimers.set(orderId, timer);
  }

  /**
   * Driver explicitly accepts matching proposal
   */
  public acceptProposal(orderId: string, driverId: string): boolean {
    const proposal = this.activeProposals.get(orderId);
    if (!proposal || proposal.driverId !== driverId || Date.now() > proposal.expiresAt) {
      return false;
    }

    const order = this.orders.get(orderId);
    const driver = this.drivers.get(driverId);
    if (!order || !driver) return false;

    this.clearProposalTimer(orderId);

    // Set transactional updates
    driver.status = 'BUSY';
    driver.currentOrderId = orderId;
    this.drivers.set(driverId, driver);

    order.assignedDriverId = driverId;
    this.orders.set(orderId, order);

    this.updateOrderState(orderId, 'ACCEPTED', `DRIVER:${driverId}`, `Order accepted by driver ${driver.name}`);
    return true;
  }

  /**
   * Driver explicitly declines matching proposal
   */
  public declineProposal(orderId: string, driverId: string) {
    const proposal = this.activeProposals.get(orderId);
    if (!proposal || proposal.driverId !== driverId) return;

    this.clearProposalTimer(orderId);
    this.activeProposals.delete(orderId);

    // Record rejection
    const rejections = this.rejectedDriversMap.get(orderId) || new Set<string>();
    rejections.add(driverId);
    this.rejectedDriversMap.set(orderId, rejections);

    this.onProposalExpired(orderId, driverId);

    // Immediately trigger search next candidate
    this.updateOrderState(orderId, 'SEARCHING_DRIVER', 'SYSTEM', 'Proposal declined, re-routing to next candidate');
  }

  private handleProposalTimeout(orderId: string) {
    const proposal = this.activeProposals.get(orderId);
    if (!proposal) return;

    console.log(`[Dispatch] Proposal for order ${orderId} timed out for driver ${proposal.driverId}`);
    
    this.declineProposal(orderId, proposal.driverId);
  }

  private clearProposalTimer(orderId: string) {
    const timer = this.proposalTimers.get(orderId);
    if (timer) {
      clearTimeout(timer);
      this.proposalTimers.delete(orderId);
    }
  }

  private seedInitialData() {
    // Spawn 5 highly experienced virtual drivers in different positions in Delhi/NCR or similar
    const center = { lat: 28.6139, lng: 77.2090 }; // Connaught Place, New Delhi
    const names = ['Aman Sharma', 'Vikram Singh', 'Rajesh Kumar', 'Deepak Verma', 'Sanjay Yadav'];
    
    names.forEach((name, i) => {
      const id = `driver_id_${i + 1}`;
      this.drivers.set(id, {
        id,
        name,
        status: 'AVAILABLE',
        location: {
          lat: center.lat + (Math.random() - 0.5) * 0.04,
          lng: center.lng + (Math.random() - 0.5) * 0.04
        },
        bearing: Math.floor(Math.random() * 360),
        speed: 0,
        batteryLevel: 90 + Math.floor(Math.random() * 10),
        currentOrderId: null,
        lastPingTime: Date.now()
      });
    });
  }
}
export const dispatchEngineInstance = new DispatchEngine();
