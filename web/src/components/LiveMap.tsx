'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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
}

interface DemandHex {
  id: string;
  lat: number;
  lng: number;
  intensity: number;
  predictedOrders: number;
}

interface LiveMapProps {
  drivers: Driver[];
  orders: Order[];
  forecast: DemandHex[];
  showHeatmap: boolean;
  onMapClick?: (latlng: LatLng) => void;
}

export default function LiveMap({ drivers, orders, forecast, showHeatmap, onMapClick }: LiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const driversGroupRef = useRef<L.LayerGroup | null>(null);
  const ordersGroupRef = useRef<L.LayerGroup | null>(null);
  const heatmapGroupRef = useRef<L.LayerGroup | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Connect Leaflet map to Connaught Place, New Delhi center
    const map = L.map(mapContainerRef.current, {
      center: [28.6139, 77.2090],
      zoom: 13,
      zoomControl: true,
      attributionControl: false
    });

    // Dark-themed premium style via CSS filter loaded in globals.css dark-map class
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    // Layer groups for active data overlays
    driversGroupRef.current = L.layerGroup().addTo(map);
    ordersGroupRef.current = L.layerGroup().addTo(map);
    heatmapGroupRef.current = L.layerGroup().addTo(map);

    // Handle clicks to place orders
    map.on('click', (e) => {
      if (onMapClick) {
        onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [onMapClick]);

  // Update Drivers Markers
  useEffect(() => {
    const map = mapRef.current;
    const group = driversGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    drivers.forEach((driver) => {
      // Custom rotating glowing SVG marker
      const truckSvg = `
        <div style="transform: rotate(${driver.bearing}deg); transition: transform 0.3s ease-out; display: flex; align-items: center; justify-content: center;">
          <svg width="34" height="34" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="22" cy="22" r="16" fill="rgba(99, 102, 241, 0.2)" stroke="#6366f1" stroke-width="2" />
            <circle cx="22" cy="22" r="6" fill="#10b981" class="${driver.speed > 0 ? 'pulse-marker-active' : ''}" />
            <path d="M22 6 L26 14 L18 14 Z" fill="#6366f1" />
          </svg>
        </div>
      `;

      const customIcon = L.divIcon({
        html: truckSvg,
        className: 'custom-driver-icon',
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });

      const marker = L.marker([driver.location.lat, driver.location.lng], { icon: customIcon });
      
      const popupContent = `
        <div style="background: #0f0f14; color: #fff; border-radius: 8px; padding: 4px; font-size: 12px; font-family: sans-serif;">
          <strong style="color: #6366f1;">🚚 ${driver.name}</strong><br/>
          Status: <span style="color: ${driver.status === 'AVAILABLE' ? '#10b981' : '#f59e0b'}; font-weight: bold;">${driver.status}</span><br/>
          Speed: ${Math.round(driver.speed * 3.6)} km/h<br/>
          Battery: ${Math.round(driver.batteryLevel)}%
        </div>
      `;
      marker.bindPopup(popupContent);
      group.addLayer(marker);
    });
  }, [drivers]);

  // Update Orders & Routes Markers
  useEffect(() => {
    const map = mapRef.current;
    const group = ordersGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    orders.forEach((order) => {
      // 1. Pickup Point (Green ring)
      const pickupIcon = L.divIcon({
        html: `
          <div style="display: flex; align-items: center; justify-content: center; position: relative;">
            <span style="position: absolute; width: 22px; height: 22px; border-radius: 50%; background: rgba(16, 185, 129, 0.25); border: 2px solid #10b981; animation: pulseGlow 2s infinite;"></span>
            <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span>
          </div>
        `,
        className: 'custom-pickup-icon',
        iconSize: [22, 22]
      });

      const pickupMarker = L.marker([order.pickupLocation.lat, order.pickupLocation.lng], { icon: pickupIcon });
      pickupMarker.bindPopup(`
        <div style="font-size: 11px;">
          <strong style="color: #10b981;">📦 Pickup Node</strong><br/>
          Address: ${order.pickupAddress}<br/>
          Order ID: ${order.id}
        </div>
      `);
      group.addLayer(pickupMarker);

      // 2. Delivery Point (Red ring)
      const deliveryIcon = L.divIcon({
        html: `
          <div style="display: flex; align-items: center; justify-content: center; position: relative;">
            <span style="position: absolute; width: 22px; height: 22px; border-radius: 50%; background: rgba(239, 68, 68, 0.25); border: 2px solid #ef4444;"></span>
            <span style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></span>
          </div>
        `,
        className: 'custom-delivery-icon',
        iconSize: [22, 22]
      });

      const deliveryMarker = L.marker([order.deliveryLocation.lat, order.deliveryLocation.lng], { icon: deliveryIcon });
      deliveryMarker.bindPopup(`
        <div style="font-size: 11px;">
          <strong style="color: #ef4444;">🏁 Delivery Node</strong><br/>
          Address: ${order.deliveryAddress}<br/>
          Order ID: ${order.id}
        </div>
      `);
      group.addLayer(deliveryMarker);

      // 3. Routing Polyline
      const pathPoints: [number, number][] = [
        [order.pickupLocation.lat, order.pickupLocation.lng],
        [order.deliveryLocation.lat, order.deliveryLocation.lng]
      ];

      const polyline = L.polyline(pathPoints, {
        color: order.status === 'DELIVERED' ? '#9ca3af' : '#6366f1',
        weight: 3,
        dashArray: order.status === 'PLACED' || order.status === 'SEARCHING_DRIVER' ? '5, 8' : undefined,
        opacity: order.status === 'DELIVERED' ? 0.4 : 0.8
      });
      group.addLayer(polyline);
    });
  }, [orders]);

  // Update Heatmap/Hex Grid forecast overlays
  useEffect(() => {
    const map = mapRef.current;
    const group = heatmapGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (!showHeatmap) return;

    forecast.forEach((hex) => {
      // Calculate hexagonal coordinates manually based on H3 spacing math
      const dLat = 0.0035;
      const dLng = 0.005;
      const points: [number, number][] = [
        [hex.lat + dLat, hex.lng],
        [hex.lat + dLat / 2, hex.lng + dLng],
        [hex.lat - dLat / 2, hex.lng + dLng],
        [hex.lat - dLat, hex.lng],
        [hex.lat - dLat / 2, hex.lng - dLng],
        [hex.lat + dLat / 2, hex.lng - dLng]
      ];

      // Hexagon glow color matching intensity (Dynamic peak hot-spots)
      const color = hex.intensity > 0.7 
        ? '#ef4444' // Red (high demand)
        : hex.intensity > 0.4 
          ? '#f59e0b' // Orange (medium demand)
          : '#10b981'; // Emerald (low/normal demand)

      const polygon = L.polygon(points, {
        color: color,
        fillColor: color,
        fillOpacity: hex.intensity * 0.45,
        weight: 1,
        opacity: 0.3
      });

      polygon.bindPopup(`
        <div style="font-size: 11px;">
          <strong>🎯 Dynamic Forecast Hex</strong><br/>
          H3 Resol: 8 (Resilient Bounds)<br/>
          Volume Weight: <span style="font-weight:bold; color:${color}">${Math.round(hex.intensity * 100)}%</span><br/>
          Predicted Orders: ${hex.predictedOrders}
        </div>
      `);

      group.addLayer(polygon);
    });
  }, [forecast, showHeatmap]);

  return (
    <div 
      ref={mapContainerRef} 
      className="w-full h-full rounded-2xl overflow-hidden border border-white/5 dark-map shadow-2xl"
      style={{ zIndex: 1 }}
    />
  );
}
