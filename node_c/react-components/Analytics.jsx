import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const MetricCard = ({ label, value, unit, subtitle, color, loading }) => (
  <div role="region" aria-label={label} style={{ flex: 1, backgroundColor: '#fff', borderRadius: '1rem', padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', textAlign: 'center' }}>
    <h4 style={{ color: '#6b7280', margin: 0, fontSize: '0.9rem', textTransform: 'uppercase' }}>{label}</h4>
    <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#111827', marginTop: '0.5rem' }}>
      {loading ? '...' : value} <span style={{ fontSize: '1rem', color: '#9ca3af' }}>{unit}</span>
    </div>
    <p style={{ margin: 0, color, fontSize: '0.85rem', fontWeight: 600 }}>{subtitle}</p>
  </div>
);

const Analytics = () => {
  const [data, setData] = useState({ automated_corrections: 0, estimated_savings_kwh: "0.0000", estimated_ac_savings_kwh: "0.0000" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);
  if (!socketRef.current) {
    socketRef.current = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 10 });
  }
  const socket = socketRef.current;

  const fetchAnalytics = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/analytics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Failed to fetch analytics', e);
      setError('Failed to load analytics. Will retry...');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
    // Refresh analytics on sensor updates (debounced via Socket.IO)
    const handleUpdate = (msg) => {
      if (msg.topic === 'smartoffice/sensors' || msg.topic?.startsWith('redis/')) {
        fetchAnalytics();
      }
    };
    socket.on('sensor-update', handleUpdate);

    return () => {
      socket.off('sensor-update', handleUpdate);
      socket.disconnect();
    };
  }, [fetchAnalytics, socket]);

  const metrics = [
    { label: 'Automated Corrections', value: data.automated_corrections, unit: 'events', subtitle: 'Ghost Occupancy Stopped', color: '#10b981' },
    { label: 'Light Savings', value: data.estimated_savings_kwh, unit: 'kWh', subtitle: 'LED Energy Saved', color: '#f59e0b' },
    { label: 'AC Savings', value: data.estimated_ac_savings_kwh || "0.0000", unit: 'kWh', subtitle: 'AC Energy Saved', color: '#3b82f6' }
  ];

  return (
    <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem', flexWrap: 'wrap' }}>
      {error && (
        <div style={{ width: '100%', padding: '0.75rem', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '0.5rem', textAlign: 'center', fontSize: '0.9rem' }}>
          ⚠️ {error}
        </div>
      )}
      {metrics.map(m => (
        <MetricCard key={m.label} loading={loading} {...m} />
      ))}
    </div>
  );
};

export default Analytics;
