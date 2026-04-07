import React, { useState, useEffect, useCallback } from 'react';
import { fetchWithTimeout } from './useSocket';

const ControlGroup = ({ name, deviceId, options, overrides, activeStates, loading, onCommand }) => {
    const currentState = activeStates[deviceId] || '...';
    let stateColor = '#9ca3af';
    if (currentState === 'ON' || currentState === 'FAST' || currentState === 'SLOW') stateColor = '#10b981';
    if (currentState === 'OFF') stateColor = '#ef4444';

    return (
    <div style={{ backgroundColor: '#fff', borderRadius: '1rem', padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', fontWeight: 600, color: '#1f2937', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span>{name}</span>
          <div role="status" aria-label={`Current state: ${currentState}`} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', padding: '0.2rem 0.6rem', backgroundColor: '#f9fafb', borderRadius: '1rem', border: '1px solid #e5e7eb' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: stateColor, boxShadow: `0 0 8px ${stateColor}aa` }} />
            <span style={{ color: '#4b5563', fontWeight: 700 }}>
               {currentState}
            </span>
          </div>
        </div>
        <span style={{ 
          backgroundColor: overrides[deviceId] === 'AUTO' ? '#e5e7eb' : '#fef08a',
          color: overrides[deviceId] === 'AUTO' ? '#4b5563' : '#854d0e',
          padding: '0.2rem 0.6rem',
          borderRadius: '1rem',
          fontSize: '0.75rem',
          fontWeight: 'bold'
        }}>{overrides[deviceId] === 'AUTO' ? 'Auto Mode' : `Forced: ${overrides[deviceId]}`}</span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {options.map(cmd => {
          let label = `Force ${cmd}`;
          if (cmd === 'AUTO') label = 'Auto';
          if (deviceId === 'AC') {
            if (cmd === 'SLOW') label = 'Increase Temp';
            else if (cmd === 'FAST') label = 'Lower Temp';
            else if (cmd === 'OFF') label = 'Force OFF';
          }
          
          return (
            <button
              key={cmd}
              onClick={() => onCommand(deviceId, cmd)}
              disabled={loading === deviceId}
              aria-label={`${name}: ${label}`}
              style={{
                flex: 1, minWidth: '80px', padding: '0.6rem', border: '1px solid #d1d5db', borderRadius: '0.4rem',
                cursor: loading === deviceId ? 'wait' : 'pointer', fontWeight: 500, transition: 'all 0.2s', fontSize: '0.85rem',
                backgroundColor: overrides[deviceId] === cmd ? '#2563eb' : '#fff',
                color: overrides[deviceId] === cmd ? '#fff' : '#374151',
                borderColor: overrides[deviceId] === cmd ? '#2563eb' : '#d1d5db',
                opacity: loading === deviceId ? 0.7 : 1
              }}
            >
              {loading === deviceId ? '⏳' : label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ControlPanel = () => {
  const [overrides, setOverrides] = useState({
    AC: 'AUTO',
    LED_1: 'AUTO',
    LED_2: 'AUTO',
    LED_3: 'AUTO',
    PRESENTATION: 'AUTO'
  });
  const [activeStates, setActiveStates] = useState({});
  const [loading, setLoading] = useState(null); // null = not loading, string = device being loaded
  const [error, setError] = useState(null);

  const fetchOverrides = useCallback(() => {
    Promise.all([
      fetchWithTimeout('/api/overrides').then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }),
      fetchWithTimeout('/api/active-commands').then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
    ])
      .then(([overridesData, commandsData]) => {
        setOverrides({
          AC: overridesData.AC || 'AUTO',
          LED_1: overridesData.LED_1 || 'AUTO',
          LED_2: overridesData.LED_2 || 'AUTO',
          LED_3: overridesData.LED_3 || 'AUTO',
          PRESENTATION: overridesData.PRESENTATION || 'AUTO'
        });
        setActiveStates(commandsData);
        setError(null);
      })
      .catch(e => {
        console.error(e);
        setError('Failed to sync device states');
      });
  }, []);

  useEffect(() => {
    fetchOverrides();
    const interval = setInterval(fetchOverrides, 3000);
    return () => clearInterval(interval);
  }, [fetchOverrides]);

  const handleCommand = useCallback(async (device, command) => {
    try {
      setLoading(device);
      setError(null);
      const res = await fetchWithTimeout('/api/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: device, command: command })
      });
      if (!res.ok) {
        let errorMsg = `Server error (HTTP ${res.status})`;
        try {
          const errData = await res.json();
          if (errData.error) errorMsg = errData.error;
        } catch { /* ignore JSON parse failure, use default message */ }
        throw new Error(errorMsg);
      }
      const result = await res.json();
      if (result.success) {
        setOverrides(prev => ({ ...prev, [device]: result.command || 'AUTO' }));
        fetchOverrides();
      }
    } catch (e) {
      console.error(e);
      setError(`Failed to override ${device}: ${e.message}`);
    } finally {
      setLoading(null);
    }
  }, [fetchOverrides]);

  return (
    <div style={{ marginTop: '1rem' }}>
      <h3 style={{ borderBottom: '2px solid #e5e7eb', paddingBottom: '0.5rem' }}>Interactive Override Control Panel</h3>
      {error && (
        <div style={{ padding: '0.75rem', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '0.5rem', textAlign: 'center', fontSize: '0.9rem', marginBottom: '1rem' }}>
          ⚠️ {error}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        <ControlGroup name="Touch Sensor Presentation Mode" deviceId="PRESENTATION" options={['AUTO', 'OFF', 'ON']} overrides={overrides} activeStates={activeStates} loading={loading} onCommand={handleCommand} />
        <ControlGroup name="Air Conditioner" deviceId="AC" options={['AUTO', 'OFF', 'SLOW', 'FAST']} overrides={overrides} activeStates={activeStates} loading={loading} onCommand={handleCommand} />
        <ControlGroup name="LED Zone 1" deviceId="LED_1" options={['AUTO', 'OFF', 'ON']} overrides={overrides} activeStates={activeStates} loading={loading} onCommand={handleCommand} />
        <ControlGroup name="LED Zone 2" deviceId="LED_2" options={['AUTO', 'OFF', 'ON']} overrides={overrides} activeStates={activeStates} loading={loading} onCommand={handleCommand} />
        <ControlGroup name="LED Zone 3" deviceId="LED_3" options={['AUTO', 'OFF', 'ON']} overrides={overrides} activeStates={activeStates} loading={loading} onCommand={handleCommand} />
      </div>
    </div>
  );
};

export default ControlPanel;
