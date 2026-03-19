import React, { useState, useEffect } from 'react';

const Analytics = () => {
  const [data, setData] = useState({ automated_corrections: 0, estimated_savings_kwh: "0.0000", estimated_ac_savings_kwh: "0.0000" });

  const fetchAnalytics = async () => {
    try {
      const res = await fetch('/api/analytics');
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Failed to fetch analytics', e);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, backgroundColor: '#fff', borderRadius: '1rem', padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', textAlign: 'center' }}>
        <h4 style={{ color: '#6b7280', margin: 0, fontSize: '0.9rem', textTransform: 'uppercase' }}>Automated Corrections</h4>
        <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#111827', marginTop: '0.5rem' }}>
          {data.automated_corrections} <span style={{ fontSize: '1rem', color: '#9ca3af' }}>events</span>
        </div>
        <p style={{ margin: 0, color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>Ghost Occupancy Stopped</p>
      </div>

      <div style={{ flex: 1, backgroundColor: '#fff', borderRadius: '1rem', padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', textAlign: 'center' }}>
        <h4 style={{ color: '#6b7280', margin: 0, fontSize: '0.9rem', textTransform: 'uppercase' }}>Light Savings</h4>
        <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#111827', marginTop: '0.5rem' }}>
          {data.estimated_savings_kwh} <span style={{ fontSize: '1rem', color: '#9ca3af' }}>kWh</span>
        </div>
        <p style={{ margin: 0, color: '#f59e0b', fontSize: '0.85rem', fontWeight: 600 }}>LED Energy Saved</p>
      </div>

      <div style={{ flex: 1, backgroundColor: '#fff', borderRadius: '1rem', padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', textAlign: 'center' }}>
        <h4 style={{ color: '#6b7280', margin: 0, fontSize: '0.9rem', textTransform: 'uppercase' }}>AC Savings</h4>
        <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#111827', marginTop: '0.5rem' }}>
          {data.estimated_ac_savings_kwh || "0.0000"} <span style={{ fontSize: '1rem', color: '#9ca3af' }}>kWh</span>
        </div>
        <p style={{ margin: 0, color: '#3b82f6', fontSize: '0.85rem', fontWeight: 600 }}>AC Energy Saved</p>
      </div>
    </div>
  );
};

export default Analytics;
