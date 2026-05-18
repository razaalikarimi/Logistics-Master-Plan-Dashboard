import { LatLng, Driver, Order } from './types';
import { DispatchEngine } from './dispatchEngine';

export class DriverSimulator {
  private activeSimulations = new Map<string, {
    path: LatLng[];
    currentIndex: number;
    timer: NodeJS.Timeout;
    orderId: string;
  }>();

  constructor(
    private dispatchEngine: DispatchEngine,
    private onLocationUpdate: (driverId: string, location: LatLng, bearing: number, speed: number) => void
  ) {}

  /**
   * Starts a simulated travel path for a driver towards a destination.
   */
  public startSimulation(driverId: string, destination: LatLng, orderId: string, speedMPS: number = 15) {
    this.stopSimulation(driverId);

    const driver = this.dispatchEngine.drivers.get(driverId);
    if (!driver) return;

    // Generate a simple interpolated path (simulating high-resolution street segments)
    const path = this.generateInterpolatedPath(driver.location, destination);
    if (path.length === 0) return;

    let currentIndex = 0;

    const timer = setInterval(() => {
      const activeSim = this.activeSimulations.get(driverId);
      if (!activeSim) {
        clearInterval(timer);
        return;
      }

      const { path, currentIndex: idx } = activeSim;
      
      if (idx >= path.length) {
        // Driver arrived at target coordinate destination
        clearInterval(timer);
        this.activeSimulations.delete(driverId);
        this.handleArrival(driverId, orderId);
        return;
      }

      const nextNode = path[idx];
      const prevNode = idx === 0 ? driver.location : path[idx - 1];

      // Calculate bearing (heading angle in degrees)
      const bearing = this.calculateBearing(prevNode, nextNode);
      // Simulate slight variance in speeds
      const speed = speedMPS + (Math.random() - 0.5) * 3;

      // Update driver record
      driver.location = nextNode;
      driver.bearing = bearing;
      driver.speed = speed;
      driver.batteryLevel = Math.max(10, driver.batteryLevel - 0.05); // Battery drain simulation
      driver.lastPingTime = Date.now();
      
      this.dispatchEngine.drivers.set(driverId, driver);
      this.onLocationUpdate(driverId, nextNode, bearing, speed);

      // Advance route index
      activeSim.currentIndex++;
    }, 1500); // Send coordinates update every 1.5 seconds

    this.activeSimulations.set(driverId, { path, currentIndex, timer, orderId });
  }

  public stopSimulation(driverId: string) {
    const active = this.activeSimulations.get(driverId);
    if (active) {
      clearInterval(active.timer);
      this.activeSimulations.delete(driverId);
    }
  }

  /**
   * Handles arrival at pickup or delivery coordinates
   */
  private handleArrival(driverId: string, orderId: string) {
    const order = this.dispatchEngine.orders.get(orderId);
    if (!order) return;

    if (order.status === 'ACCEPTED') {
      // Arrived at pickup
      this.dispatchEngine.updateOrderState(
        orderId,
        'ARRIVED_AT_PICKUP',
        `DRIVER:${driverId}`,
        'Driver arrived at pickup warehouse'
      );
      
      // Auto pickup after 3 seconds
      setTimeout(() => {
        this.dispatchEngine.updateOrderState(
          orderId,
          'PICKED_UP',
          `DRIVER:${driverId}`,
          'Driver loaded cargo and departed'
        );
        // Start simulation towards customer delivery coordinates
        this.dispatchEngine.updateOrderState(orderId, 'IN_TRANSIT', `DRIVER:${driverId}`);
        this.startSimulation(driverId, order.deliveryLocation, orderId, 18);
      }, 3500);

    } else if (order.status === 'IN_TRANSIT') {
      // Arrived at delivery point
      this.dispatchEngine.updateOrderState(
        orderId,
        'DELIVERED',
        `DRIVER:${driverId}`,
        'Package successfully delivered to customer!'
      );

      // Restore driver availability status
      const driver = this.dispatchEngine.drivers.get(driverId);
      if (driver) {
        driver.status = 'AVAILABLE';
        driver.currentOrderId = null;
        driver.speed = 0;
        this.dispatchEngine.drivers.set(driverId, driver);
      }
    }
  }

  /**
   * Linear geographical interpolation to simulate smooth continuous movement paths
   */
  private generateInterpolatedPath(start: LatLng, end: LatLng, stepsCount: number = 25): LatLng[] {
    const path: LatLng[] = [];
    
    // Create direct segment path with slight bezier-resembling curves (adds natural movement)
    for (let i = 1; i <= stepsCount; i++) {
      const progress = i / stepsCount;
      
      // Interpolate lat and lng
      const lat = start.lat + (end.lat - start.lat) * progress;
      const lng = start.lng + (end.lng - start.lng) * progress;
      
      // Add slight jitter representing real city road curvature
      const roadWarp = Math.sin(progress * Math.PI * 3) * 0.0006;
      
      path.push({
        lat: lat + roadWarp,
        lng: lng + roadWarp
      });
    }

    return path;
  }

  /**
   * Computes geographical angle in degrees between two points
   */
  private calculateBearing(p1: LatLng, p2: LatLng): number {
    const lat1 = (p1.lat * Math.PI) / 180;
    const lat2 = (p2.lat * Math.PI) / 180;
    const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360; // Normalize between 0 and 360 degrees
  }
}
export const simulatorInstance = new DriverSimulator(
  new DispatchEngine(), // Temp baseline
  () => {}
);
