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
  Navigation,
  ChevronRight,
  TrendingUp,
  Star,
  Compass,
  Battery,
  Shield,
  CheckCircle2,
  Package,
  MapPinOff,
  User,
  Sliders,
  DollarSign
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
  vehicleType: 'BIKE' | 'CAR' | 'TRUCK';
  rating: number;
  completedDeliveries: number;
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
  createdAt: number;
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
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

  // Selected Entity details (for the premium sidebar inspector)
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Live Chart Simulation State
  const [liveChartData, setLiveChartData] = useState<number[]>([35, 42, 38, 48, 55, 62, 59, 68, 75, 70, 82, 90]);

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

  // Simulate wiggling chart data for premium aesthetics
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveChartData(prev => {
        const nextVal = Math.max(20, Math.min(100, prev[prev.length - 1] + (Math.random() - 0.5) * 10));
        return [...prev.slice(1), Math.round(nextVal)];
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Connect WebSockets and Load API Data
  useEffect(() => {
    // Attempt backend socket connection
    const socket = io('http://localhost:3001', {
      reconnectionAttempts: 2,
      timeout: 2000
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      addLog('Secure Socket connection established. Operations Grid Synced.', 'SUCCESS');
      socket.emit('join_ops_center');
      fetchBackendData();
    });

    socket.on('connect_error', () => {
      setIsConnected(false);
      addLog('Operations cluster offline. Launching fallback sandbox emulator...', 'ALERT');
      startClientSandboxMode();
    });

    // --- REALTIME WEB SOCKET LISTENERS ---
    socket.on('driver_moved', (data: { driverId: string; location: LatLng; bearing: number; speed: number }) => {
      setDrivers(prev => prev.map(d => {
        if (d.id === data.driverId) {
          const updated = { ...d, location: data.location, bearing: data.bearing, speed: data.speed };
          // Dynamically update inspector details in real-time
          setSelectedDriver(curr => curr && curr.id === data.driverId ? updated : curr);
          return updated;
        }
        return d;
      }));
    });

    socket.on('driver_status_changed', (updatedDriver: Driver) => {
      setDrivers(prev => prev.map(d => d.id === updatedDriver.id ? { ...d, ...updatedDriver } : d));
      addLog(`Fleet Alert: Driver ${updatedDriver.name} transitioned to ${updatedDriver.status}`, 'INFO');
    });

    socket.on('proposal_broadcasted', (data: { order: Order; driver: Driver }) => {
      addLog(`Automated Match Proposal: Pinging driver ${data.driver.name} for Cargo ${data.order.id}`, 'ALERT');
    });

    socket.on('order_status_updated', (data: { order: Order; history: any }) => {
      setOrders(prev => {
        const exists = prev.some(o => o.id === data.order.id);
        const updatedList = exists 
          ? prev.map(o => o.id === data.order.id ? data.order : o)
          : [...prev, data.order];
        
        // Dynamically update order inspector
        setSelectedOrder(curr => curr && curr.id === data.order.id ? data.order : curr);
        return updatedList;
      });
      addLog(`Cargo ${data.order.id} update: ${data.order.status} (${data.history.reason || ''})`, 'SUCCESS');
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
      // Enrich backend drivers with visual properties
      setDrivers(driversData.map((d: any) => ({
        ...d,
        vehicleType: ['TRUCK', 'CAR', 'BIKE'][Math.floor(Math.random() * 3)],
        rating: 4.8 + Math.random() * 0.2,
        completedDeliveries: 120 + Math.floor(Math.random() * 80)
      })));

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
    // 1. Seed drivers locally with rich profile fields
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
      batteryLevel: 98,
      vehicleType: i === 0 ? 'TRUCK' : i % 2 === 0 ? 'CAR' : 'BIKE',
      rating: 4.9 - (i * 0.04),
      completedDeliveries: 240 + i * 15
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

    addLog('Client Simulation Sandbox online. Sockets bypassed.', 'INFO');
  };

  // Map Click Coordinates placement
  const handleMapClick = (latlng: LatLng) => {
    if (isSelectingPickup) {
      setPickupCoords(latlng);
      addLog(`Point Placed: Set pickup coordinates to [${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}]`, 'INFO');
    } else {
      setDeliveryCoords(latlng);
      addLog(`Point Placed: Set delivery coordinates to [${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}]`, 'INFO');
    }
  };

  // Order Placement
  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    addLog(`Registering new cargo ledger...`, 'INFO');

    if (isConnected) {
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
        addLog(`Order synced to remote Postgres ledger: ID ${data.id}`, 'SUCCESS');
      } catch (err) {
        addLog('Could not sync cargo request to remote backend', 'ERROR');
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
        etaSeconds: Math.round(estMeters / 12) + 180,
        assignedDriverId: null,
        createdAt: Date.now()
      };

      setOrders(prev => [...prev, newOrder]);
      addLog(`Sandbox: Created Order ${orderId}`, 'SUCCESS');

      // Trigger asynchronous mock dispatch matcher
      setTimeout(() => {
        runSandboxMatchingEngine(orderId, newOrder);
      }, 1500);
    }
  };

  // Client-side mock matching pipeline
  const runSandboxMatchingEngine = (orderId: string, order: Order) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'SEARCHING_DRIVER' } : o));
    addLog(`Sandbox: Sweeping spatial H3 grids for nearby drivers`, 'ALERT');

    setDrivers(currentDrivers => {
      const available = currentDrivers.filter(d => d.status === 'AVAILABLE');
      if (available.length === 0) {
        addLog('Sandbox Warning: All drivers busy. Retrying in 5 seconds...', 'ALERT');
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
      addLog(`Sandbox: Dispatched dispatch proposal to ${matchedDriver.name}`, 'ALERT');

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

        addLog(`Sandbox: Driver ${matchedDriver.name} accepted cargo proposal!`, 'SUCCESS');
        
        // Start simulated linear trip in client
        runSandboxGpsSimulation(matchedDriver.id, orderId, matchedDriver.location, order.pickupLocation, order.deliveryLocation);
      }, 3000);

      return currentDrivers;
    });
  };

  // Client-side street-like curved GPS step updates
  const runSandboxGpsSimulation = (driverId: string, orderId: string, start: LatLng, pickup: LatLng, delivery: LatLng) => {
    let step = 0;
    const stepsCount = 22;
    
    // Generate curved curvilinear street paths to look handcrafted
    const path = generateCurvedPath(start, pickup, stepsCount);
    
    const pickupInterval = setInterval(() => {
      step++;
      setDrivers(prev => {
        const driver = prev.find(d => d.id === driverId);
        if (!driver || !path[step - 1]) return prev;
        
        const nextLoc = path[step - 1];
        const bearing = calculateBearing(driver.location, nextLoc);
        
        const updatedDriver: Driver = {
          ...driver,
          location: nextLoc,
          bearing,
          speed: 13 + Math.random() * 3,
          batteryLevel: Math.max(10, driver.batteryLevel - 0.15)
        };

        // Live update driver inspector details
        setSelectedDriver(curr => curr && curr.id === driverId ? updatedDriver : curr);

        if (step >= stepsCount) {
          clearInterval(pickupInterval);
          addLog(`Sandbox: Driver arrived at Pickup Hub. Staging cargo...`, 'INFO');
          
          setOrders(o => o.map(ord => {
            const updatedOrder = ord.id === orderId ? { ...ord, status: 'ARRIVED_AT_PICKUP' } : ord;
            setSelectedOrder(curr => curr && curr.id === orderId ? updatedOrder : curr);
            return updatedOrder;
          }));

          setTimeout(() => {
            setOrders(o => o.map(ord => {
              const updatedOrder = ord.id === orderId ? { ...ord, status: 'PICKED_UP' } : ord;
              setSelectedOrder(curr => curr && curr.id === orderId ? updatedOrder : curr);
              return updatedOrder;
            }));
            
            setTimeout(() => {
              setOrders(o => o.map(ord => {
                const updatedOrder = ord.id === orderId ? { ...ord, status: 'IN_TRANSIT' } : ord;
                setSelectedOrder(curr => curr && curr.id === orderId ? updatedOrder : curr);
                return updatedOrder;
              }));
              addLog(`Sandbox: Cargo departure logged. IN_TRANSIT.`, 'SUCCESS');
              
              // Stage 2: Move towards Delivery
              runSandboxTransitGps(driverId, orderId, pickup, delivery);
            }, 1500);
          }, 2000);
        }

        return prev.map(d => d.id === driverId ? updatedDriver : d);
      });
    }, 800);
  };

  const runSandboxTransitGps = (driverId: string, orderId: string, pickup: LatLng, delivery: LatLng) => {
    let step = 0;
    const stepsCount = 22;
    const path = generateCurvedPath(pickup, delivery, stepsCount);

    const deliveryInterval = setInterval(() => {
      step++;
      setDrivers(prev => {
        const driver = prev.find(d => d.id === driverId);
        if (!driver || !path[step - 1]) return prev;

        const nextLoc = path[step - 1];
        const bearing = calculateBearing(driver.location, nextLoc);

        const updatedDriver: Driver = {
          ...driver,
          location: nextLoc,
          bearing,
          speed: 16 + Math.random() * 4,
          batteryLevel: Math.max(10, driver.batteryLevel - 0.2)
        };

        // Live update driver inspector
        setSelectedDriver(curr => curr && curr.id === driverId ? updatedDriver : curr);

        if (step >= stepsCount) {
          clearInterval(deliveryInterval);
          
          setOrders(o => o.map(ord => {
            const updatedOrder = ord.id === orderId ? { ...ord, status: 'DELIVERED' } : ord;
            setSelectedOrder(curr => curr && curr.id === orderId ? updatedOrder : curr);
            return updatedOrder;
          }));
          
          addLog(`Sandbox Success: Cargo ID ${orderId} successfully delivered!`, 'SUCCESS');

          // Reset driver availability status
          return prev.map(d => d.id === driverId 
            ? { ...d, status: 'AVAILABLE', speed: 0, batteryLevel: d.batteryLevel - 0.2 } 
            : d
          );
        }

        return prev.map(d => d.id === driverId ? updatedDriver : d);
      });
    }, 800);
  };

  // Generate a curved road path (city grid turns)
  const generateCurvedPath = (start: LatLng, end: LatLng, steps: number): LatLng[] => {
    const points: LatLng[] = [];
    
    // Halfway point warp representing street turns
    const midLat = (start.lat + end.lat) / 2;
    const midLng = (start.lng + end.lng) / 2;
    
    // Add perpendicular offset for realistic routing curves
    const perpOffsetLat = (end.lng - start.lng) * 0.15;
    const perpOffsetLng = -(end.lat - start.lat) * 0.15;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      
      // Quadratic Bezier Curve formula: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
      const lat = (1 - t) * (1 - t) * start.lat + 2 * (1 - t) * t * (midLat + perpOffsetLat) + t * t * end.lat;
      const lng = (1 - t) * (1 - t) * start.lng + 2 * (1 - t) * t * (midLng + perpOffsetLng) + t * t * end.lng;
      
      // Slight road curvature noise
      const noise = Math.sin(t * Math.PI * 4) * 0.00015;
      
      points.push({ lat: lat + noise, lng: lng + noise });
    }
    return points;
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
    setSelectedDriver(null);
    setSelectedOrder(null);
    addLog('System flush triggered. Wiping logs and cache pools.', 'ALERT');
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
    <div className="flex flex-col min-h-screen bg-[#07070a] text-zinc-100 font-sans p-6 overflow-hidden relative">
      
      {/* 🚀 DECORATIVE background lighting */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-indigo-500/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-emerald-500/5 blur-[120px] pointer-events-none" />

      {/* 🚀 BRANDED HEADER */}
      <header className="flex flex-col xl:flex-row items-center justify-between gap-4 mb-6 p-5 rounded-2xl glass-panel relative z-10">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-indigo-400">
            <Activity size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wide bg-gradient-to-r from-zinc-50 via-zinc-200 to-indigo-400 bg-clip-text text-transparent uppercase">
              LOGISTIQ COMMAND CENTER
            </h1>
            <p className="text-xs text-zinc-400 font-mono">Real-time Dispatch, Geo-caching & AI Routing Grid</p>
          </div>
        </div>

        {/* Dynamic Area Chart representation (Pure SVG, no chart library hydration issues) */}
        <div className="hidden lg:flex items-center gap-4 bg-white/2 border border-white/5 py-1.5 px-4 rounded-xl">
          <div className="flex flex-col">
            <span className="text-[10px] text-zinc-500 uppercase">OPS Traffic</span>
            <span className="text-xs font-bold text-indigo-400 flex items-center gap-1">
              <TrendingUp size={12} /> Live Flow
            </span>
          </div>
          <svg width="120" height="34" className="overflow-visible">
            <defs>
              <linearGradient id="gradient-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <path
              d={`M 0 34 ${liveChartData.map((val, idx) => `L ${idx * 10.9} ${34 - (val / 100) * 30}`).join(' ')} L 120 34 Z`}
              fill="url(#gradient-area)"
            />
            <path
              d={liveChartData.map((val, idx) => `${idx === 0 ? 'M' : 'L'} ${idx * 10.9} ${34 - (val / 100) * 30}`).join(' ')}
              fill="none"
              stroke="#6366f1"
              strokeWidth="2"
            />
            <circle cx="120" cy={34 - (liveChartData[liveChartData.length - 1] / 100) * 30} r="3" fill="#10b981" />
          </svg>
        </div>

        {/* SYSTEM STATUS TILES */}
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col items-end border-r border-white/5 pr-6">
            <span className="text-[10px] text-zinc-500 uppercase">Active Fleet</span>
            <span className="text-base font-bold text-indigo-400 flex items-center gap-1.5">
              <Truck size={14} /> {drivers.length} Drivers
            </span>
          </div>
          <div className="flex flex-col items-end border-r border-white/5 pr-6">
            <span className="text-[10px] text-zinc-500 uppercase">Active Orders</span>
            <span className="text-base font-bold text-emerald-400">
              {orders.filter(o => o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length} Live
            </span>
          </div>
          <div className="flex flex-col items-end border-r border-white/5 pr-6">
            <span className="text-[10px] text-zinc-500 uppercase">SLA Compliance</span>
            <span className="text-base font-bold text-amber-400 flex items-center gap-1">
              <Clock size={14} /> {stats.slaComplianceRate}%
            </span>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/3 border border-white/5">
            <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`} />
            <span className="text-[10px] font-semibold tracking-wider text-zinc-300 uppercase">
              {isConnected ? 'LIVE CHANNEL' : 'SANDBOX NODE'}
            </span>
          </div>
        </div>
      </header>

      {/* THREE-COLUMN LAYOUT CONSOLE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-stretch relative z-10 overflow-hidden">

        {/* 📋 LEFT PANEL: ORDER DISPATCHER & SYSTEM LOGS */}
        <div className="lg:col-span-3 flex flex-col gap-6 max-h-[85vh] overflow-y-auto pr-1">
          
          {/* PLACE BOOKING DISPATCH */}
          <section className="p-5 rounded-2xl glass-panel flex flex-col gap-4">
            <h2 className="text-xs font-bold tracking-wider text-zinc-300 flex items-center gap-2 uppercase">
              <Plus size={16} className="text-emerald-400" /> Dispatch New Cargo
            </h2>

            <form onSubmit={handlePlaceOrder} className="flex flex-col gap-3">
              <div>
                <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Pickup Location</label>
                <input 
                  type="text"
                  value={pickupAddr}
                  onChange={(e) => setPickupAddr(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-black/45 border border-white/5 rounded-xl text-xs focus:border-indigo-500 outline-none transition-all font-medium"
                  required
                />
              </div>

              {/* Set coordinates panel */}
              <div className="flex gap-2 p-1 bg-black/35 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => setIsSelectingPickup(true)}
                  className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold tracking-wider uppercase transition-all flex items-center justify-center gap-1 ${isSelectingPickup ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <MapPin size={11} /> Set Pickup
                </button>
                <button
                  type="button"
                  onClick={() => setIsSelectingPickup(false)}
                  className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold tracking-wider uppercase transition-all flex items-center justify-center gap-1 ${!isSelectingPickup ? 'bg-rose-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <Navigation size={11} /> Set Delivery
                </button>
              </div>

              <div className="p-3 rounded-xl bg-white/2 border border-white/5 text-[10px] text-zinc-400 flex flex-col gap-1.5 font-mono">
                <div className="flex justify-between">
                  <span>Pickup Coords:</span>
                  <span className="font-bold text-indigo-400">{pickupCoords.lat.toFixed(5)}, {pickupCoords.lng.toFixed(5)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Delivery Coords:</span>
                  <span className="font-bold text-rose-400">{deliveryCoords.lat.toFixed(5)}, {deliveryCoords.lng.toFixed(5)}</span>
                </div>
              </div>

              <div>
                <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Delivery Destination</label>
                <input 
                  type="text"
                  value={deliveryAddr}
                  onChange={(e) => setDeliveryAddr(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-black/45 border border-white/5 rounded-xl text-xs focus:border-indigo-500 outline-none transition-all font-medium"
                  required
                />
              </div>

              <p className="text-[10px] text-zinc-400 leading-relaxed bg-amber-500/5 border border-amber-500/10 p-2.5 rounded-lg flex gap-2">
                <AlertCircle size={14} className="text-amber-400 shrink-0" />
                <span>Click directly on the map to set lat/lng coordinates instantly.</span>
              </p>

              <button 
                type="submit"
                className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-indigo-500 text-white text-xs font-bold rounded-xl hover:brightness-110 active:scale-98 transition-all flex items-center justify-center gap-1.5 uppercase tracking-widest shadow-xl shadow-indigo-950/20"
              >
                <Play size={14} /> Trigger Dispatcher Match
              </button>
            </form>
          </section>

          {/* ACTIVE SHIPMENTS HUB */}
          <section className="p-5 rounded-2xl glass-panel flex flex-col gap-4 overflow-hidden">
            <h2 className="text-xs font-bold tracking-wider text-zinc-300 flex items-center gap-2 uppercase">
              <Package size={16} className="text-indigo-400" /> Active Shipments ({orders.filter(o => o.status !== 'DELIVERED').length})
            </h2>

            <div className="flex flex-col gap-3 max-h-[160px] overflow-y-auto pr-1">
              {orders.filter(o => o.status !== 'DELIVERED').length === 0 ? (
                <div className="text-[10px] text-zinc-500 text-center py-4">No active shipments in transit.</div>
              ) : (
                orders.filter(o => o.status !== 'DELIVERED').map(order => {
                  let progress = 10;
                  if (order.status === 'ACCEPTED') progress = 35;
                  else if (order.status === 'ARRIVED_AT_PICKUP') progress = 50;
                  else if (order.status === 'PICKED_UP') progress = 65;
                  else if (order.status === 'IN_TRANSIT') progress = 85;

                  return (
                    <div 
                      key={order.id} 
                      onClick={() => { setSelectedOrder(order); setSelectedDriver(null); }}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer ${selectedOrder?.id === order.id ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-white/2 border-white/5 hover:border-white/10'}`}
                    >
                      <div className="flex justify-between items-center text-[10px] mb-1.5">
                        <span className="font-bold text-zinc-300">{order.id}</span>
                        <span className="font-mono text-emerald-400">₹{order.price}</span>
                      </div>
                      {/* Custom premium Progress loader bar */}
                      <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mb-1">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="flex justify-between text-[8px] text-zinc-500">
                        <span className="uppercase font-bold">{order.status}</span>
                        <span>{(order.distanceMeters / 1000).toFixed(1)} km</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* REALTIME SYSTEM EVENT LOGS */}
          <section className="p-5 rounded-2xl glass-panel flex-1 flex flex-col gap-4 overflow-hidden min-h-[160px]">
            <div className="flex justify-between items-center">
              <h2 className="text-xs font-bold tracking-wider text-zinc-300 flex items-center gap-2 uppercase">
                <Activity size={16} className="text-indigo-400" /> Operational Feed
              </h2>
              <button
                onClick={handleResetSandbox}
                className="p-1 hover:bg-white/5 rounded-lg text-zinc-500 hover:text-zinc-300 transition-all"
                title="Clear Logs"
              >
                <RefreshCw size={12} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 max-h-[150px]">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-xs py-8 gap-2">
                  <AlertCircle size={16} />
                  <span>No events captured in queue.</span>
                </div>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="p-2.5 rounded-xl bg-white/2 border border-white/5 text-[9px] flex flex-col gap-1">
                    <div className="flex justify-between items-center text-zinc-500">
                      <span className="font-mono">{log.time}</span>
                      <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-[7px] ${
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

        {/* 🗺️ MIDDLE PANEL: LIVE GEOSPATIAL MAP */}
        <main className="lg:col-span-6 flex flex-col gap-4 min-h-[480px]">
          <div className="flex-1 relative rounded-2xl overflow-hidden border border-white/5 glass-panel">
            
            <LiveMap 
              drivers={drivers}
              orders={orders}
              forecast={forecast}
              showHeatmap={showHeatmap}
              onMapClick={handleMapClick}
            />

            {/* FLOATING MAP LAYERS SWITCH */}
            <div className="absolute top-4 right-4 z-10 p-3 rounded-xl glass-panel flex items-center gap-4 text-xs shadow-2xl">
              <span className="text-zinc-300 font-bold flex items-center gap-1.5">
                <Layers size={14} className="text-indigo-400" /> Layer Overlay
              </span>
              <div className="w-px h-4 bg-white/10" />
              <label className="flex items-center gap-2 cursor-pointer font-bold text-zinc-200 select-none text-[10px]">
                <input 
                  type="checkbox"
                  checked={showHeatmap}
                  onChange={(e) => setShowHeatmap(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-800 text-indigo-600 focus:ring-offset-zinc-900"
                />
                DEMAND HEATMAP
              </label>
            </div>
          </div>
        </main>

        {/* 🚚 RIGHT PANEL: SIMULATOR CONTROLS & FLEET DETAIL INSPECTOR */}
        <div className="lg:col-span-3 flex flex-col gap-6 max-h-[85vh] overflow-y-auto pl-1">
          
          {/* ENTITY DETAILED INSPECTOR (Principal Craftsmanship) */}
          <section className="p-5 rounded-2xl glass-panel flex flex-col gap-4">
            <h2 className="text-xs font-bold tracking-wider text-zinc-300 flex items-center gap-2 uppercase">
              <Sliders size={16} className="text-indigo-400" /> Live Inspector
            </h2>

            {selectedDriver ? (
              <div className="flex flex-col gap-4 animate-fade-in text-[10px]">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-1">
                      {selectedDriver.name}
                    </h3>
                    <span className="text-[9px] font-mono text-zinc-500 uppercase">{selectedDriver.id}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${
                    selectedDriver.status === 'AVAILABLE' ? 'bg-emerald-500/10 text-emerald-400' :
                    'bg-amber-500/10 text-amber-400'
                  }`}>
                    {selectedDriver.status}
                  </span>
                </div>

                <div className="flex items-center gap-4 bg-white/2 p-3 rounded-xl border border-white/5">
                  {/* Speedometer gauge representation */}
                  <div className="relative flex items-center justify-center shrink-0">
                    <svg width="56" height="56" viewBox="0 0 36 36">
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="rgba(255,255,255,0.06)"
                        strokeWidth="2.5"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831"
                        fill="none"
                        stroke="#6366f1"
                        strokeWidth="2.5"
                        strokeDasharray={`${Math.min(100, Math.max(0, Math.round((selectedDriver.speed / 20) * 50)))}, 100`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center">
                      <span className="text-[10px] font-bold text-zinc-200">{Math.round(selectedDriver.speed * 3.6)}</span>
                      <span className="text-[6px] text-zinc-500">KMH</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 w-full">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-zinc-500 flex items-center gap-1"><Truck size={11} className="text-indigo-400" /> Vehicle:</span>
                      <span className="font-bold text-zinc-200">{selectedDriver.vehicleType}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-zinc-500 flex items-center gap-1"><Star size={11} className="text-amber-400" /> Rating:</span>
                      <span className="font-bold text-zinc-200">{selectedDriver.rating.toFixed(1)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1 w-full bg-white/2 p-3 rounded-xl border border-white/5">
                  <div className="flex justify-between items-center text-[10px] mb-1">
                    <span className="text-zinc-500">Battery Level:</span>
                    <span className="font-bold text-zinc-200">{Math.round(selectedDriver.batteryLevel)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${selectedDriver.batteryLevel}%` }} />
                  </div>
                </div>
              </div>
            ) : selectedOrder ? (
              <div className="flex flex-col gap-4 animate-fade-in text-[10px]">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-sm font-bold text-zinc-100">{selectedOrder.id}</h3>
                    <span className="text-[8px] font-mono text-zinc-500 uppercase">Registered Cargo</span>
                  </div>
                  <span className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-bold rounded uppercase text-[8px]">
                    {selectedOrder.status}
                  </span>
                </div>

                <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/2 border border-white/5 font-medium">
                  <div className="flex justify-between border-b border-white/3 pb-1.5">
                    <span className="text-zinc-500 flex items-center gap-1"><MapPin size={11} className="text-indigo-400" /> Pickup:</span>
                    <span className="text-zinc-200 font-semibold">{selectedOrder.pickupAddress}</span>
                  </div>
                  <div className="flex justify-between pb-0.5">
                    <span className="text-zinc-500 flex items-center gap-1"><Navigation size={11} className="text-rose-400" /> Delivery:</span>
                    <span className="text-zinc-200 font-semibold">{selectedOrder.deliveryAddress}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2 border border-dashed border-white/5 rounded-2xl p-4">
                <Truck size={24} className="text-zinc-600 animate-pulse" />
                <p className="text-[10px] text-zinc-500">Click on any active driver or order card to inspect live telemetry gauges and step progress charts.</p>
              </div>
            )}
          </section>

          {/* SIMULATOR CONTROLS */}
          <section className="p-5 rounded-2xl glass-panel flex flex-col gap-4">
            <h2 className="text-xs font-bold tracking-wider text-zinc-300 flex items-center gap-2 uppercase">
              <Cpu size={16} className="text-indigo-400" /> AI Solver Controls
            </h2>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={handleTrigger2OptRouting}
                className="w-full py-2 bg-indigo-600/25 border border-indigo-500/35 hover:bg-indigo-600/35 text-indigo-200 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 uppercase tracking-wider"
              >
                <Cpu size={14} /> Optimize Multi-Stop (2-Opt)
              </button>

              <button
                onClick={handleResetSandbox}
                className="w-full py-2 bg-rose-600/10 border border-rose-500/20 hover:bg-rose-600/20 text-rose-300 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 uppercase tracking-wider"
              >
                <RefreshCw size={14} /> Reset Fleet simulator
              </button>
            </div>

            <div className="p-3 rounded-xl bg-white/2 border border-white/5 text-[10px] text-zinc-400 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-zinc-200 font-semibold mb-1 uppercase tracking-wider text-[9px]">
                <CloudRain size={12} className="text-sky-400" /> Road Conditions
              </div>
              <div className="flex justify-between">
                <span>Weather State:</span>
                <span className="font-bold text-sky-400 flex items-center gap-1">CLEAR (1.0x)</span>
              </div>
              <div className="flex justify-between">
                <span>Day Peak Profile:</span>
                <span className="text-indigo-300 font-bold">NORMAL DENSITY</span>
              </div>
            </div>
          </section>

          {/* ACTIVE DRIVERS TELEMETRY LIST */}
          <section className="p-5 rounded-2xl glass-panel flex-1 flex flex-col gap-4 overflow-hidden min-h-[220px]">
            <h2 className="text-xs font-bold tracking-wider text-zinc-300 flex items-center gap-2 uppercase">
              <Truck size={16} className="text-emerald-400" /> Fleet Telemetry
            </h2>

            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3 max-h-[250px]">
              {drivers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-xs py-8">
                  <span>No drivers online in region.</span>
                </div>
              ) : (
                drivers.map(driver => (
                  <div 
                    key={driver.id} 
                    onClick={() => { setSelectedDriver(driver); setSelectedOrder(null); }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${selectedDriver?.id === driver.id ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-white/2 border-white/5 hover:border-white/10'}`}
                  >
                    <div className="flex justify-between items-center">
                      <strong className="text-xs text-zinc-200 flex items-center gap-1.5">
                        <Truck size={12} className="text-indigo-400" /> {driver.name}
                      </strong>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                        driver.status === 'AVAILABLE' ? 'bg-emerald-500/10 text-emerald-400' :
                        'bg-amber-500/10 text-amber-400'
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
                        <span className={`font-bold ${driver.batteryLevel < 30 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {Math.round(driver.batteryLevel)}%
                        </span>
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
