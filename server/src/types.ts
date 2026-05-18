export interface LatLng {
  lat: number;
  lng: number;
}

export type DriverStatus = 'OFFLINE' | 'AVAILABLE' | 'BUSY';

export interface Driver {
  id: string;
  name: string;
  status: DriverStatus;
  location: LatLng;
  bearing: number;
  speed: number;
  batteryLevel: number;
  currentOrderId: string | null;
  lastPingTime: number;
}

export type OrderStatus =
  | 'DRAFT'
  | 'PLACED'
  | 'SEARCHING_DRIVER'
  | 'ACCEPTED'
  | 'ARRIVED_AT_PICKUP'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  status: OrderStatus;
  pickupAddress: string;
  pickupLocation: LatLng;
  deliveryAddress: string;
  deliveryLocation: LatLng;
  price: number;
  etaSeconds: number;
  distanceMeters: number;
  assignedDriverId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface OrderStatusHistory {
  id: string;
  orderId: string;
  status: OrderStatus;
  updatedBy: string;
  reason: string;
  timestamp: number;
}

export interface MatchingProposal {
  orderId: string;
  driverId: string;
  score: number;
  expiresAt: number;
}
