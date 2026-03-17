import React, { useState, useEffect } from 'react';

const ControlPanel = () => {
  const [overrides, setOverrides] = useState({
    AC: 'AUTO',
    LED_1: 'AUTO',
    LED_2: 'AUTO',
    LED_3: 'AUTO'
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/overrides')
      .then(res => res.json())
      .then(data => {
        setOverrides({
          AC: data.AC || 'AUTO',
          LED_1: data.LED_1 || 'AUTO',
          LED_2: data.LED_2 || 'AUTO',
          LED_3: data.LED_3 || 'AUTO'
        });
      })
      .catch(console.error);
  }, []);

  const handleCommand = async (device, command) => {
    try {
      setLoading(device);
      const res = await fetch('/api/overrides', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ device_id: device, command: command })
      });
      const result = await res.json();
      if (result.success) {
        setOverrides(prev => ({ ...prev, [device]: result.command || 'AUTO' }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const ControlGroup = ({ name, deviceId, options }) => (
    <div style={{ backgroundColor: '#fff', borderRadius: '1rem', padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontWeight: 600, color: '#1f2937' }}>
        <span>{name}</span>
        <span style={{ 
          backgroundColor: overrides[deviceId] === 'AUTO' ? '#e5e7eb' : '#fef08a',
          color: overrides[deviceId] === 'AUTO' ? '#4b5563' : '#854d0e',
          padding: '0.2rem 0.6rem',
          borderRadius: '1rem',
          fontSize: '0.75rem',
          fontWeight: 'bold'
        }}>{overrides[deviceId]}</span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {options.map(cmd => (
          <button
            key={cmd}
            onClick={() => handleCommand(deviceId, cmd)}
            disabled={loading === deviceId}
            style={{
              flex: 1, padding: '0.6rem', border: '1px solid #d1d5db', borderRadius: '0.4rem',
              cursor: 'pointer', fontWeight: 500, transition: 'all 0.2s',
              backgroundColor: overrides[deviceId] === cmd ? '#2563eb' : '#fff',
              color: overrides[deviceId] === cmd ? '#fff' : '#374151',
              borderColor: overrides[deviceId] === cmd ? '#2563eb' : '#d1d5db'
            }}
          >
            {cmd === 'AUTO' ? 'Auto' : `Force ${cmd}`}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ marginTop: '1rem' }}>
      <h3 style={{ borderBottom: '2px solid #e5e7eb', paddingBottom: '0.5rem' }}>Interactive Override Control Panel</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        <ControlGroup name="Air Conditioner" deviceId="AC" options={['AUTO', 'OFF', 'SLOW', 'FAST']} />
        <ControlGroup name="LED Zone 1" deviceId="LED_1" options={['AUTO', 'OFF', 'ON']} />
        <ControlGroup name="LED Zone 2" deviceId="LED_2" options={['AUTO', 'OFF', 'ON']} />
        <ControlGroup name="LED Zone 3" deviceId="LED_3" options={['AUTO', 'OFF', 'ON']} />
      </div>
    </div>
  );
};

export default ControlPanel;
