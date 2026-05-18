'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { 
  Truck, 
  MapPin, 
  Layers, 
  Play, 
  Plus, 
  Activity, 
  Clock, 
  AlertCircle, 
  RefreshCw, 
  Cpu, 
  CloudRain,
  Navigation
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';

// Load LiveMap dynamically with no SSR to support Leaflet safely in Next.js App Router
const LiveMap = dynamic(() => import('../components/LiveMap'), { ssr: false });

interface LatLng {
  lat: number;
  lng: number;
}

interface Driver {
  id: string;
  name: string;
  status: 'OFFLINE' | 'AVAILABLE' | 'BUSY';
  location: LatLng;
  bearing: number;
  speed: number;
  batteryLevel: number;
}

interface Order {
  id: string;
  status: string;
  pickupAddress: string;
  pickupLocation: LatLng;
  deliveryAddress: string;
  deliveryLocation: LatLng;
  price: number;
  distanceMeters: number;
  etaSeconds: number;
  assignedDriverId: string | null;
}

interface DemandHex {
  id: string;
  lat: number;
  lng: number;
  intensity: number;
  predictedOrders: number;
}

interface LogEntry {
  id: string;
  time: string;
  type: 'INFO' | 'SUCCESS' | 'ALERT' | 'ERROR';
  message: string;
}

export default function OperationsDashboard() {
  const [isConnected, setIsConnected] = useState(false);
  const [stats, setStats] = useState({
    totalDrivers: 5,
    activeDrivers: 5,
    busyDrivers: 0,
    pendingOrders: 0,
    completedOrders: 0,
    slaComplianceRate: 98.4
  });

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [forecast, setForecast] = useState<DemandHex[]>([]);
  
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Placement State
  const [pickupAddr, setPickupAddr] = useState('Central Cargo Hub A');
  const [pickupCoords, setPickupCoords] = useState<LatLng>({ lat: 28.6150, lng: 77.2000 });
  const [deliveryAddr, setDeliveryAddr] = useState('Metro Logistics Terminal');
  const [deliveryCoords, setDeliveryCoords] = useState<LatLng>({ lat: 28.6250, lng: 77.2250 });
  const [isSelectingPickup, setIsSelectingPickup] = useState(true);

  // References
  const socketRef = useRef<Socket | null>(null);
  const sandboxIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to add operational logs
  const addLog = (message: string, type: LogEntry['type'] = 'INFO') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [
      { id: Math.random().toString(), time, type, message },
      ...prev.slice(0, 49) // Keep last 50 logs
    ]);
  };

  // Connect WebSockets and Load API Data
  useEffect(() => {
    // Attempt backend socket connection
    const socket = io('http://localhost:3001', {
      reconnectionAttempts: 3,
      timeout: 3000
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      addLog('Connected to Real-time Backend Engine Gateway', 'SUCCESS');
      socket.emit('join_ops_center');
      fetchBackendData();
    });

    socket.on('connect_error', () => {
      setIsConnected(false);
      addLog('Backend offline. Degrading to client sandbox engine...', 'ALERT');
      startClientSandboxMode();
    });

    // --- REALTIME WEB SOCKET LISTENERS ---
    socket.on('driver_moved', (data: { driverId: string; location: LatLng; bearing: number; speed: number }) => {
      setDrivers(prev => prev.map(d => d.id === data.driverId 
        ? { ...d, location: data.location, bearing: data.bearing, speed: data.speed }
        : d
      ));
    });

    socket.on('driver_status_changed', (updatedDriver: Driver) => {
      setDrivers(prev => prev.map(d => d.id === updatedDriver.id ? updatedDriver : d));
      addLog(`Driver status updated: ${updatedDriver.name} is now ${updatedDriver.status}`, 'INFO');
    });

    socket.on('proposal_broadcasted', (data: { order: Order; driver: Driver }) => {
      addLog(`Matching Search: Proposal proposed to driver ${data.driver.name} for Order ${data.order.id}`, 'ALERT');
    });

    socket.on('proposal_withdrawn', (data: { orderId: string; driverId: string }) => {
      addLog(`Proposal timed out/declined for driver ${data.driverId} (Order ${data.orderId})`, 'INFO');
    });

    socket.on('order_status_updated', (data: { order: Order; history: any }) => {
      setOrders(prev => {
        const exists = prev.some(o => o.id === data.order.id);
        if (exists) {
          return prev.map(o => o.id === data.order.id ? data.order : o);
        } else {
          return [...prev, data.order];
        }
      });
      addLog(`Order ${data.order.id} transitioned to: ${data.order.status} (${data.history.reason || ''})`, 'SUCCESS');
      
      // Refresh stats
      fetchBackendStats();
    });

    return () => {
      socket.disconnect();
      if (sandboxIntervalRef.current) clearInterval(sandboxIntervalRef.current);
    };
  }, []);

  // Fetch initial REST data from Express Backend
  const fetchBackendData = async () => {
    try {
      fetchBackendStats();
      
      const driversRes = await fetch('http://localhost:3001/api/drivers');
      const driversData = await driversRes.json();
      setDrivers(driversData);

      const ordersRes = await fetch('http://localhost:3001/api/orders');
      const ordersData = await ordersRes.json();
      setOrders(ordersData);

      const forecastRes = await fetch('http://localhost:3001/api/demand-forecast');
      const forecastData = await forecastRes.json();
      setForecast(forecastData);
      
    } catch (e) {
      console.warn('REST API fetches failed', e);
    }
  };

  const fetchBackendStats = async () => {
    try {
      const statsRes = await fetch('http://localhost:3001/api/stats');
      const statsData = await statsRes.json();
      setStats(statsData);
    } catch (e) {}
  };

  // --- CLIENT SANDBOX SIMULATOR FALLBACK MODE ---
  const startClientSandboxMode = () => {
    // 1. Seed drivers locally
    const center = { lat: 28.6139, lng: 77.2090 };
    const mockDrivers: Driver[] = Array.from({ length: 5 }).map((_, i) => ({
      id: `sandbox_driver_${i + 1}`,
      name: ['Aman Sharma', 'Vikram Singh', 'Rajesh Kumar', 'Deepak Verma', 'Sanjay Yadav'][i],
      status: 'AVAILABLE',
      location: {
        lat: center.lat + (Math.random() - 0.5) * 0.03,
        lng: center.lng + (Math.random() - 0.5) * 0.03
      },
      bearing: Math.floor(Math.random() * 360),
      speed: 0,
      batteryLevel: 95
    }));
    setDrivers(mockDrivers);

    // 2. Mock forecast overlay hexagons
    const spacingLat = 0.0075;
    const spacingLng = 0.0095;
    const mockForecast: DemandHex[] = [];
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const dist = Math.sqrt(r * r + c * c);
        const intensity = Math.max(0.1, 1 - dist / 3.5);
        mockForecast.push({
          id: `sand_hex_${r}_${c}`,
          lat: center.lat + r * spacingLat + (c % 2 === 0 ? 0 : spacingLat / 2),
          lng: center.lng + c * spacingLng,
          intensity,
          predictedOrders: Math.round(intensity * 10) + 1
        });
      }
    }
    setForecast(mockForecast);

    addLog('Client Sandbox initialized. Ready for simulation pings.', 'INFO');
  };

  // Map Click Coordinates placement
  const handleMapClick = (latlng: LatLng) => {
    if (isSelectingPickup) {
      setPickupCoords(latlng);
      addLog(`Selected Pickup coordinates: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`, 'INFO');
    } else {
      setDeliveryCoords(latlng);
      addLog(`Selected Delivery coordinates: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`, 'INFO');
    }
  };

  // Order Placement
  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    addLog(`Submitting cargo request...`, 'INFO');

    if (isConnected) {
      // Send REST order to active Express/Socket.io backend
      try {
        const res = await fetch('http://localhost:3001/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pickupAddress: pickupAddr,
            pickupLocation: pickupCoords,
            deliveryAddress: deliveryAddr,
            deliveryLocation: deliveryCoords
          })
        });
        const data = await res.json();
        addLog(`Order placed successfully on Server: ID ${data.id}`, 'SUCCESS');
      } catch (err) {
        addLog('Failed to connect to order API', 'ERROR');
      }
    } else {
      // Execute in-browser Sandbox matching state machine
      const orderId = `ord_sand_${Math.random().toString(36).substring(2, 7)}`;
      const rawDistance = calculateDistance(pickupCoords, deliveryCoords);
      const estMeters = rawDistance * 1.25;
      const price = Math.round(estMeters * 0.015) + 120;

      const newOrder: Order = {
        id: orderId,
        status: 'PLACED',
        pickupAddress: pickupAddr,
        pickupLocation: pickupCoords,
        deliveryAddress: deliveryAddr,
        deliveryLocation: deliveryCoords,
        price,
        distanceMeters: Math.round(estMeters),
        etaSeconds: Math.round(estMeters / 10) + 180,
        assignedDriverId: null
      };

      setOrders(prev => [...prev, newOrder]);
      addLog(`Sandbox: Placed Order ${orderId}`, 'SUCCESS');

      // Trigger asynchronous mock dispatch matcher
      setTimeout(() => {
        runSandboxMatchingEngine(orderId, newOrder);
      }, 1500);
    }
  };

  // Client-side mock matching pipeline
  const runSandboxMatchingEngine = (orderId: string, order: Order) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'SEARCHING_DRIVER' } : o));
    addLog(`Sandbox: Querying closest available drivers for Order ${orderId}`, 'ALERT');

    setDrivers(currentDrivers => {
      const available = currentDrivers.filter(d => d.status === 'AVAILABLE');
      if (available.length === 0) {
        addLog('Sandbox: No available drivers. Retrying in 5 seconds...', 'ALERT');
        setTimeout(() => runSandboxMatchingEngine(orderId, order), 5000);
        return currentDrivers;
      }

      // Sort by closest distance
      const sorted = [...available].sort((a, b) => {
        const distA = calculateDistance(order.pickupLocation, a.location);
        const distB = calculateDistance(order.pickupLocation, b.location);
        return distA - distB;
      });

      const matchedDriver = sorted[0];
      addLog(`Sandbox: Match proposed to ${matchedDriver.name} (Order: ${orderId})`, 'ALERT');

      // Automatically accept proposal after 3 seconds
      setTimeout(() => {
        setOrders(prevOrders => prevOrders.map(o => o.id === orderId 
          ? { ...o, status: 'ACCEPTED', assignedDriverId: matchedDriver.id } 
          : o
        ));

        setDrivers(prevDrivers => prevDrivers.map(d => d.id === matchedDriver.id 
          ? { ...d, status: 'BUSY' } 
          : d
        ));

        addLog(`Sandbox: ${matchedDriver.name} accepted Order ${orderId}!`, 'SUCCESS');
        
        // Start simulated linear trip in client
        runSandboxGpsSimulation(matchedDriver.id, orderId, order.pickupLocation, order.deliveryLocation);
      }, 3000);

      return currentDrivers;
    });
  };

  // Client-side linear GPS step updates
  const runSandboxGpsSimulation = (driverId: string, orderId: string, pickup: LatLng, delivery: LatLng) => {
    let step = 0;
    const stepsCount = 20;
    
    // Stage 1: Move towards Pickup
    const pickupInterval = setInterval(() => {
      step++;
      setDrivers(prev => {
        const driver = prev.find(d => d.id === driverId);
        if (!driver) return prev;
        
        const nextLat = driver.location.lat + (pickup.lat - driver.location.lat) * (1 / (stepsCount - step + 1));
        const nextLng = driver.location.lng + (pickup.lng - driver.location.lng) * (1 / (stepsCount - step + 1));
        
        const bearing = calculateBearing(driver.location, { lat: nextLat, lng: nextLng });
        
        if (step >= stepsCount) {
          clearInterval(pickupInterval);
          addLog(`Sandbox: Driver arrived at pickup node!`, 'INFO');
          
          // Depart after loading
          setTimeout(() => {
            setOrders(o => o.map(ord => ord.id === orderId ? { ...ord, status: 'IN_TRANSIT' } : ord));
            addLog(`Sandbox: Package loaded, vehicle IN_TRANSIT`, 'SUCCESS');
            
            // Stage 2: Move towards Delivery
            runSandboxTransitGps(driverId, orderId, pickup, delivery);
          }, 2000);
        }

        return prev.map(d => d.id === driverId 
          ? { ...d, location: { lat: nextLat, lng: nextLng }, bearing, speed: 12, batteryLevel: d.batteryLevel - 0.2 } 
          : d
        );
      });
    }, 1000);
  };

  const runSandboxTransitGps = (driverId: string, orderId: string, pickup: LatLng, delivery: LatLng) => {
    let step = 0;
    const stepsCount = 20;

    const deliveryInterval = setInterval(() => {
      step++;
      setDrivers(prev => {
        const driver = prev.find(d => d.id === driverId);
        if (!driver) return prev;

        const nextLat = driver.location.lat + (delivery.lat - driver.location.lat) * (1 / (stepsCount - step + 1));
        const nextLng = driver.location.lng + (delivery.lng - driver.location.lng) * (1 / (stepsCount - step + 1));

        const bearing = calculateBearing(driver.location, { lat: nextLat, lng: nextLng });

        if (step >= stepsCount) {
          clearInterval(deliveryInterval);
          setOrders(o => o.map(ord => ord.id === orderId ? { ...ord, status: 'DELIVERED' } : ord));
          addLog(`Sandbox: Cargo delivered to customer! ID: ${orderId}`, 'SUCCESS');

          // Reset driver
          return prev.map(d => d.id === driverId 
            ? { ...d, status: 'AVAILABLE', speed: 0, batteryLevel: d.batteryLevel - 0.3 } 
            : d
          );
        }

        return prev.map(d => d.id === driverId 
          ? { ...d, location: { lat: nextLat, lng: nextLng }, bearing, speed: 15, batteryLevel: d.batteryLevel - 0.2 } 
          : d
        );
      });
    }, 1000);
  };

  // Helper Math: Haversine distance
  const calculateDistance = (p1: LatLng, p2: LatLng): number => {
    const R = 6371000;
    const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
    const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((p1.lat * Math.PI) / 180) *
        Math.cos((p2.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const calculateBearing = (p1: LatLng, p2: LatLng): number => {
    const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos((p2.lat * Math.PI) / 180);
    const x =
      Math.cos((p1.lat * Math.PI) / 180) * Math.sin((p2.lat * Math.PI) / 180) -
      Math.sin((p1.lat * Math.PI) / 180) *
        Math.cos((p2.lat * Math.PI) / 180) *
        Math.cos(dLng);
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
  };

  // Reset simulator
  const handleResetSandbox = () => {
    setOrders([]);
    addLog('Resetting sandbox operations log', 'ALERT');
    if (isConnected) {
      fetchBackendData();
    } else {
      startClientSandboxMode();
    }
  };

  // Run Route Optimization Solver via REST API
  const handleTrigger2OptRouting = async () => {
    if (orders.length < 2) {
      addLog('Need at least 2 active orders to run 2-Opt TSP optimization', 'ALERT');
      return;
    }

    addLog('Optimizing routes using 2-Opt local search...', 'INFO');
    const center = { lat: 28.6139, lng: 77.2090 };
    const stops = orders.map(o => o.pickupLocation);

    if (isConnected) {
      try {
        const res = await fetch('http://localhost:3001/api/optimize-route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: center, stops })
        });
        const data = await res.json();
        addLog(`Solver completed: Optimized ${data.originalStopsCount} stops successfully!`, 'SUCCESS');
      } catch (err) {
        addLog('Routing API server failed', 'ERROR');
      }
    } else {
      // Local sandbox solver simulation
      addLog('Sandbox: 2-Opt solver resolved optimized sequence locally.', 'SUCCESS');
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#07070a] text-zinc-100 font-sans p-6 overflow-hidden">
      
      {/* 🚀 GLOWING HEADER & OPERATIONS TIMELINE */}
      <header className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6 p-5 rounded-2xl glass-panel relative">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400 animate-pulse">
            <Activity size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-zinc-50 via-zinc-200 to-indigo-400 bg-clip-text text-transparent">
              LOGISTIQ COMMAND CENTER
            </h1>
            <p className="text-xs text-zinc-400">Real-time Dispatch, Geo-caching & AI Routing Grid</p>
          </div>
        </div>

        {/* STATS TILES */}
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col items-end border-r border-white/5 pr-6">
            <span className="text-xs text-zinc-500 uppercase">Active Fleet</span>
            <span className="text-base font-bold text-indigo-400 flex items-center gap-1.5">
              <Truck size={14} /> {drivers.length} Drivers
            </span>
          </div>
          <div className="flex flex-col items-end border-r border-white/5 pr-6">
            <span className="text-xs text-zinc-500 uppercase">Active Orders</span>
            <span className="text-base font-bold text-emerald-400">
              {orders.filter(o => o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length} Live
            </span>
          </div>
          <div className="flex flex-col items-end border-r border-white/5 pr-6">
            <span className="text-xs text-zinc-500 uppercase">SLA Success</span>
            <span className="text-base font-bold text-amber-400 flex items-center gap-1">
              <Clock size={14} /> {stats.slaComplianceRate}%
            </span>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/5 border border-white/5">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-ping' : 'bg-amber-500 animate-ping'}`} />
            <span className="text-xs font-semibold text-zinc-300">
              {isConnected ? 'LIVE CHANNEL' : 'SANDBOX NODE'}
            </span>
          </div>
        </div>
      </header>

      {/* MAIN THREE-COLUMN WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-stretch">

        {/* 📋 LEFT CONTROL PANEL: DISPATCHER LOG & BOOKING */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          
          {/* CARGO PLACEMENT FORM */}
          <section className="p-5 rounded-2xl glass-panel flex flex-col gap-4">
            <h2 className="text-sm font-semibold tracking-wider text-zinc-300 flex items-center gap-2 uppercase">
              <Plus size={16} className="text-emerald-400" /> Dispatch New Cargo
            </h2>

            <form onSubmit={handlePlaceOrder} className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-zinc-500 uppercase">Pickup Location Name</label>
                <input 
                  type="text"
                  value={pickupAddr}
                  onChange={(e) => setPickupAddr(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/5 rounded-xl text-xs focus:border-indigo-500 outline-none"
                  required
                />
              </div>

              <div className="flex gap-2 p-1.5 bg-black/35 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => setIsSelectingPickup(true)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold tracking-wider uppercase transition-all ${isSelectingPickup ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <MapPin size={10} className="inline mr-1" /> Set Pickup
                </button>
                <button
                  type="button"
                  onClick={() => setIsSelectingPickup(false)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold tracking-wider uppercase transition-all ${!isSelectingPickup ? 'bg-rose-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <Navigation size={10} className="inline mr-1" /> Set Delivery
                </button>
              </div>

              <div className="p-2.5 rounded-xl bg-white/2 border border-white/5 text-[11px] text-zinc-400 flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <span>Pickup Geocoord:</span>
                  <span className="font-mono text-indigo-400">{pickupCoords.lat.toFixed(4)}, {pickupCoords.lng.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Delivery Geocoord:</span>
                  <span className="font-mono text-rose-400">{deliveryCoords.lat.toFixed(4)}, {deliveryCoords.lng.toFixed(4)}</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-500 uppercase">Delivery Destination Address</label>
                <input 
                  type="text"
                  value={deliveryAddr}
                  onChange={(e) => setDeliveryAddr(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/5 rounded-xl text-xs focus:border-indigo-500 outline-none"
                  required
                />
              </div>

              <p className="text-[10px] text-zinc-500 leading-normal bg-amber-500/5 border border-amber-500/10 p-2.5 rounded-lg">
                💡 **Pro-Tip:** Click anywhere on the map component to dynamically set coords based on your active selection.
              </p>

              <button 
                type="submit"
                className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-indigo-500 text-white text-xs font-bold rounded-xl hover:brightness-110 active:scale-98 transition-all flex items-center justify-center gap-1.5 uppercase tracking-wider"
              >
                <Play size={14} /> Trigger Dispatcher Match
              </button>
            </form>
          </section>

          {/* REALTIME SYSTEM EVENT LOGS */}
          <section className="p-5 rounded-2xl glass-panel flex-1 flex flex-col gap-4 overflow-hidden min-h-[220px]">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold tracking-wider text-zinc-300 flex items-center gap-2 uppercase">
                <Activity size={16} className="text-indigo-400" /> Operational Feed
              </h2>
              <button
                onClick={handleResetSandbox}
                className="p-1 hover:bg-white/5 rounded-lg text-zinc-500 hover:text-zinc-300"
                title="Clear Logs"
              >
                <RefreshCw size={12} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3 max-h-[300px]">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-xs py-8 gap-2">
                  <AlertCircle size={16} />
                  <span>No events captured in queue.</span>
                </div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="p-2.5 rounded-xl bg-white/2 border border-white/5 text-[10px] flex flex-col gap-1">
                    <div className="flex justify-between items-center text-zinc-500">
                      <span className="font-mono">{log.time}</span>
                      <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-[8px] ${
                        log.type === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' :
                        log.type === 'ALERT' ? 'bg-amber-500/10 text-amber-400' :
                        log.type === 'ERROR' ? 'bg-rose-500/10 text-rose-400' :
                        'bg-zinc-500/10 text-zinc-400'
                      }`}>
                        {log.type}
                      </span>
                    </div>
                    <p className="text-zinc-300 leading-normal font-sans">{log.message}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* 🗺️ MIDDLE COLUMN: THE LIVE GEOSPATIAL MAP */}
        <main className="lg:col-span-6 flex flex-col gap-4 min-h-[480px]">
          <div className="flex-1 relative rounded-2xl overflow-hidden border border-white/5 glass-panel">
            
            <LiveMap 
              drivers={drivers}
              orders={orders}
              forecast={forecast}
              showHeatmap={showHeatmap}
              onMapClick={handleMapClick}
            />

            {/* FLOATING MAP MAP LAYERS PANEL */}
            <div className="absolute top-4 right-4 z-10 p-3 rounded-xl glass-panel flex items-center gap-4 text-xs">
              <span className="text-zinc-400 font-semibold flex items-center gap-1.5">
                <Layers size={14} className="text-indigo-400" /> Layer Overlay
              </span>
              <div className="w-px h-4 bg-white/10" />
              <label className="flex items-center gap-2 cursor-pointer font-medium text-zinc-300 select-none">
                <input 
                  type="checkbox"
                  checked={showHeatmap}
                  onChange={(e) => setShowHeatmap(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-800 text-indigo-600 focus:ring-offset-zinc-900"
                />
                Demand Forecast Heatmap
              </label>
            </div>
          </div>
        </main>

        {/* 🚚 RIGHT COLUMN: SIMULATORS & FLEET MANAGER */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          
          {/* SIMULATOR CONTROLS */}
          <section className="p-5 rounded-2xl glass-panel flex flex-col gap-4">
            <h2 className="text-sm font-semibold tracking-wider text-zinc-300 flex items-center gap-2 uppercase">
              <Cpu size={16} className="text-indigo-400" /> AI Solver Controls
            </h2>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={handleTrigger2OptRouting}
                className="w-full py-2 bg-indigo-600/20 border border-indigo-500/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 uppercase"
              >
                <Cpu size={14} /> Optimize Multi-Stop (2-Opt)
              </button>

              <button
                onClick={handleResetSandbox}
                className="w-full py-2 bg-rose-600/10 border border-rose-500/20 hover:bg-rose-600/20 text-rose-300 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 uppercase"
              >
                <RefreshCw size={14} /> Reset Fleet simulator
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-white/2 border border-white/5 text-[10px] text-zinc-400 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-zinc-300 font-semibold mb-1">
                <CloudRain size={12} className="text-sky-400" /> Weather Coefficients
              </div>
              <div className="flex justify-between">
                <span>Current State:</span>
                <span className="font-bold text-sky-400 flex items-center gap-1">CLEAR (1.0x)</span>
              </div>
              <div className="flex justify-between">
                <span>Speed Scalar:</span>
                <span>Normal road velocities</span>
              </div>
            </div>
          </section>

          {/* ACTIVE DRIVERS TELEMETRY */}
          <section className="p-5 rounded-2xl glass-panel flex-1 flex flex-col gap-4 overflow-hidden min-h-[220px]">
            <h2 className="text-sm font-semibold tracking-wider text-zinc-300 flex items-center gap-2 uppercase">
              <Truck size={16} className="text-emerald-400" /> Fleet Telemetry
            </h2>

            <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3 max-h-[300px]">
              {drivers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-xs py-8">
                  <span>No drivers online in region.</span>
                </div>
              ) : (
                drivers.map(driver => (
                  <div key={driver.id} className="p-3 rounded-xl glass-card flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <strong className="text-xs text-zinc-200">🚚 {driver.name}</strong>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                        driver.status === 'AVAILABLE' ? 'bg-emerald-500/10 text-emerald-400' :
                        driver.status === 'BUSY' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-zinc-500/10 text-zinc-400'
                      }`}>
                        {driver.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[9px] text-zinc-500 font-mono">
                      <div className="flex justify-between border-b border-white/2 pb-1">
                        <span>Speed:</span>
                        <span className="text-zinc-300 font-bold">{Math.round(driver.speed * 3.6)} km/h</span>
                      </div>
                      <div className="flex justify-between border-b border-white/2 pb-1">
                        <span>Battery:</span>
                        <span className={`font-bold ${driver.batteryLevel < 30 ? 'text-rose-400' : 'text-zinc-300'}`}>
                          {Math.round(driver.batteryLevel)}%
                        </span>
                      </div>
                      <div className="flex justify-between col-span-2">
                        <span>Coords:</span>
                        <span className="text-indigo-400">{driver.location.lat.toFixed(4)}, {driver.location.lng.toFixed(4)}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

      </div>

    </div>
  );
}
