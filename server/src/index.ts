import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { dispatchEngineInstance } from './dispatchEngine';
import { DriverSimulator } from './simulator';
import { predictETA, optimizeRoute, generateDemandForecast } from './optimizationEngine';
import { LatLng } from './types';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Port configuration
const PORT = process.env.PORT || 3001;

// 1. Initialize Simulator with active Dispatch Engine and WebSockets triggers
const simulator = new DriverSimulator(
  dispatchEngineInstance,
  (driverId, location, bearing, speed) => {
    // Socket broadcast driver coordinates
    io.to('ops-center').emit('driver_moved', { driverId, location, bearing, speed });
    
    // Broadcast to specific order channel if driver is on active task
    const driver = dispatchEngineInstance.drivers.get(driverId);
    if (driver?.currentOrderId) {
      io.to(`order:${driver.currentOrderId}`).emit('tracking_update', {
        driverId,
        location,
        bearing,
        speed,
        batteryLevel: driver.batteryLevel
      });
    }
  }
);

// Register dispatch event listeners to update sockets in real-time
dispatchEngineInstance.registerCallbacks({
  onProposalCreated: (proposal, order, driver) => {
    console.log(`[Socket] Proposal Created for driver ${driver.name} (Order: ${order.id})`);
    // Send matching notification to the specific driver client
    io.to(`driver:${driver.id}`).emit('proposal_received', { proposal, order });
    
    // Update operations control dashboard
    io.to('ops-center').emit('proposal_broadcasted', { proposal, order, driver });
  },
  onProposalExpired: (orderId, driverId) => {
    console.log(`[Socket] Proposal Expired for driver ${driverId}`);
    io.to(`driver:${driverId}`).emit('proposal_withdrawn', { orderId });
    io.to('ops-center').emit('proposal_withdrawn', { orderId, driverId });
  },
  onOrderStateChanged: (order, history) => {
    console.log(`[Socket] Order ${order.id} transitioned to: ${order.status}`);
    // Broadcast to tracking channels
    io.to(`order:${order.id}`).emit('order_status_updated', { order, history });
    io.to('ops-center').emit('order_status_updated', { order, history });

    // Handle automated simulator trigger when accepted
    if (order.status === 'ACCEPTED' && order.assignedDriverId) {
      // Driver simulator moves from driver current location to order pickup coordinates
      simulator.startSimulation(order.assignedDriverId, order.pickupLocation, order.id, 14);
    }
  }
});

// --- REST API ENDPOINTS ---

// Get active operational statistics
app.get('/api/stats', (req, res) => {
  const drivers = Array.from(dispatchEngineInstance.drivers.values());
  const orders = Array.from(dispatchEngineInstance.orders.values());

  const activeDrivers = drivers.filter(d => d.status !== 'OFFLINE').length;
  const busyDrivers = drivers.filter(d => d.status === 'BUSY').length;
  const pendingOrders = orders.filter(o => o.status === 'PLACED' || o.status === 'SEARCHING_DRIVER').length;
  const completedOrders = orders.filter(o => o.status === 'DELIVERED').length;

  res.json({
    totalDrivers: drivers.length,
    activeDrivers,
    busyDrivers,
    pendingOrders,
    completedOrders,
    slaComplianceRate: 98.4 // Simulated benchmark
  });
});

// List all drivers and positions
app.get('/api/drivers', (req, res) => {
  res.json(Array.from(dispatchEngineInstance.drivers.values()));
});

// List all active and completed orders
app.get('/api/orders', (req, res) => {
  res.json(Array.from(dispatchEngineInstance.orders.values()));
});

// Create/Place a new logistics order
app.post('/api/orders', (req, res) => {
  const { pickupAddress, pickupLocation, deliveryAddress, deliveryLocation, price } = req.body;

  if (!pickupLocation || !deliveryLocation) {
    return res.status(400).json({ error: 'Pickup and delivery locations are required' });
  }

  // Calculate high-fidelity ETA and direct driving road distance
  const etaData = predictETA(pickupLocation, deliveryLocation, {
    weather: 'CLEAR',
    hourOfDay: new Date().getHours()
  });

  const orderId = `ord_${Math.random().toString(36).substring(2, 9)}`;
  const newOrder = {
    id: orderId,
    customerId: 'cust_ops_admin',
    customerName: 'Operations Admin Center',
    status: 'PLACED' as const,
    pickupAddress: pickupAddress || 'Central Cargo Terminal A',
    pickupLocation,
    deliveryAddress: deliveryAddress || 'West Distribution Gateway',
    deliveryLocation,
    price: price || Math.round(etaData.distanceMeters * 0.015) + 120, // Distance billing calculation
    etaSeconds: etaData.etaSeconds,
    distanceMeters: etaData.distanceMeters,
    assignedDriverId: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  dispatchEngineInstance.orders.set(orderId, newOrder);
  dispatchEngineInstance.updateOrderState(orderId, 'PLACED', 'OPERATIONS', 'Order submitted to dispatch log');

  // Immediately transition order to SEARCHING_DRIVER to run automated spatial matching
  setTimeout(() => {
    dispatchEngineInstance.updateOrderState(orderId, 'SEARCHING_DRIVER', 'SYSTEM', 'Triggering automated geospatial radial match');
  }, 1000);

  res.status(201).json(newOrder);
});

// Trigger TSP / Multi-Stop Route Optimization Solver (2-Opt)
app.post('/api/optimize-route', (req, res) => {
  const { origin, stops }: { origin: LatLng; stops: LatLng[] } = req.body;

  if (!origin || !stops || stops.length === 0) {
    return res.status(400).json({ error: 'Origin and stops coordinates are required' });
  }

  const optimizedStops = optimizeRoute(origin, stops);
  res.json({
    originalStopsCount: stops.length,
    optimizedPath: optimizedStops
  });
});

// Get Spatiotemporal Demand Forecasting Grid Overlays
app.get('/api/demand-forecast', (req, res) => {
  // Center of operation: New Delhi CP area
  const center = { lat: 28.6139, lng: 77.2090 };
  const forecast = generateDemandForecast(center);
  res.json(forecast);
});

// Manually trigger a GPS trip simulation (useful for dashboard tests)
app.post('/api/simulate-gps', (req, res) => {
  const { driverId, destination, orderId } = req.body;
  
  if (!driverId || !destination) {
    return res.status(400).json({ error: 'DriverId and destination coordinates are required' });
  }

  simulator.startSimulation(driverId, destination, orderId || 'manual_test_trip', 16);
  res.json({ success: true, message: `Started GPS simulation for driver ${driverId}` });
});

// --- WEBSOCKET CHANNELS / SOCKET.IO EVENT LOOP ---

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Operations Dashboard Joins general room
  socket.on('join_ops_center', () => {
    socket.join('ops-center');
    console.log(`[Socket] Socket ${socket.id} joined 'ops-center'`);
  });

  // Client joins tracking room for a specific order
  socket.on('join_order_tracking', (orderId: string) => {
    socket.join(`order:${orderId}`);
    console.log(`[Socket] Client ${socket.id} tracking order ${orderId}`);
    
    // Send current driver coordinates instantly if already assigned
    const order = dispatchEngineInstance.orders.get(orderId);
    if (order?.assignedDriverId) {
      const driver = dispatchEngineInstance.drivers.get(order.assignedDriverId);
      if (driver) {
        socket.emit('tracking_update', {
          driverId: driver.id,
          location: driver.location,
          bearing: driver.bearing,
          speed: driver.speed,
          batteryLevel: driver.batteryLevel
        });
      }
    }
  });

  // Driver client logs into app
  socket.on('join_driver', (driverId: string) => {
    socket.join(`driver:${driverId}`);
    console.log(`[Socket] Driver ${driverId} connected via client`);
    
    const driver = dispatchEngineInstance.drivers.get(driverId);
    if (driver) {
      driver.status = 'AVAILABLE';
      dispatchEngineInstance.drivers.set(driverId, driver);
      
      // Update global dashboard
      io.to('ops-center').emit('driver_status_changed', driver);
    }
  });

  // Client responds to matching proposals
  socket.on('accept_order', (data: { orderId: string; driverId: string }) => {
    const success = dispatchEngineInstance.acceptProposal(data.orderId, data.driverId);
    socket.emit('action_response', { action: 'accept', success });
  });

  socket.on('decline_order', (data: { orderId: string; driverId: string }) => {
    dispatchEngineInstance.declineProposal(data.orderId, data.driverId);
    socket.emit('action_response', { action: 'decline', success: true });
  });

  // Raw telemetry updates received from actual GPS clients (bypassing simulator)
  socket.on('location_telemetry', (data: {
    driverId: string;
    location: LatLng;
    bearing: number;
    speed: number;
    batteryLevel: number;
  }) => {
    const { driverId, location, bearing, speed, batteryLevel } = data;
    const driver = dispatchEngineInstance.drivers.get(driverId);
    
    if (driver) {
      driver.location = location;
      driver.bearing = bearing;
      driver.speed = speed;
      driver.batteryLevel = batteryLevel;
      driver.lastPingTime = Date.now();
      dispatchEngineInstance.drivers.set(driverId, driver);

      // Broadcast changes
      io.to('ops-center').emit('driver_moved', { driverId, location, bearing, speed });
      
      if (driver.currentOrderId) {
        io.to(`order:${driver.currentOrderId}`).emit('tracking_update', {
          driverId, location, bearing, speed, batteryLevel
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// Start listening
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 LOGISTICS REAL-TIME ENGINE RUNNING ON PORT ${PORT}`);
  console.log(`👉 WS Gateway URL: ws://localhost:${PORT}`);
  console.log(`===================================================`);
});
