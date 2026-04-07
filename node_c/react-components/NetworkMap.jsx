import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSocket, fetchWithTimeout } from './useSocket';
import { Wifi, Server, Activity, Cpu } from 'lucide-react';

// Extracted outside component to avoid re-creation on every render
const NodeIcon = React.memo(({ icon: Icon, label, status }) => (
  <div role="status" aria-live="polite" aria-atomic="true" aria-label={`${label}: ${status}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 20px' }}>
    <div style={{
      backgroundColor: '#fff',
      padding: '1.5rem',
      borderRadius: '50%',
      boxShadow: `0 0 15px ${status === 'online' ? '#22c55e' : '#ef4444'}`,
      transition: 'box-shadow 0.3s, border-color 0.3s'
    }}>
      <Icon color={status === 'online' ? '#22c55e' : '#ef4444'} size={40} />
    </div>
    <span style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>{label}</span>
    <span style={{ color: status === 'online' ? '#22c55e' : '#ef4444', fontSize: '0.8rem', textTransform: 'uppercase' }}>{status}</span>
  </div>
));

const NetworkMap = () => {
  const socket = useSocket();
  const [nodes, setNodes] = useState({
    server: 'online',
    node_a: 'offline', 
    node_b: 'offline', 
    node_c: 'online'  
  });
  const [socketStatus, setSocketStatus] = useState('connected');

  const timeouts = useRef({
    node_a: null,
    node_b: null
  });

  const markNodeActive = (nodeId) => {
    setNodes((prev) => ({ ...prev, [nodeId]: 'online' }));

    if (timeouts.current[nodeId]) {
      clearTimeout(timeouts.current[nodeId]);
    }

    timeouts.current[nodeId] = setTimeout(() => {
      setNodes((prev) => ({ ...prev, [nodeId]: 'offline' }));
    }, 15000);
  };

  useEffect(() => {
    fetchWithTimeout('/api/nodes')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        setNodes(prev => ({ ...prev, ...data }));
        Object.keys(data).forEach(nodeId => {
          if (data[nodeId] === 'online' && nodeId !== 'server') {
            markNodeActive(nodeId);
          }
        });
      })
      .catch(console.error);

    socket.on('sensor-update', (data) => {
      if (!data.topic) return;

      if (data.topic.startsWith('smartoffice/sensors')) {
        markNodeActive('node_a');
      }

      if (data.topic.startsWith('smartoffice/status/node_b')) {
        markNodeActive('node_b');
      }

      if (data.topic.startsWith('smartoffice/status/')) {
        const nodeId = data.topic.split('/').pop();
        if (data.payload && data.payload.status === 'offline') {
          setNodes((prev) => ({ ...prev, [nodeId]: 'offline' }));
          if (timeouts.current[nodeId]) clearTimeout(timeouts.current[nodeId]);
        } else if (data.payload && data.payload.status === 'online') {
           markNodeActive(nodeId);
        }
      }
    });

    // Socket connection status monitoring
    socket.on('connect', () => setSocketStatus('connected'));
    socket.on('disconnect', () => setSocketStatus('disconnected'));
    socket.on('connect_error', () => setSocketStatus('error'));

    return () => {
      socket.off('sensor-update');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      Object.values(timeouts.current).forEach(clearTimeout);
    };
  }, []);

  return (
    <div style={{ padding: '2rem', backgroundColor: '#1f2937', borderRadius: '1rem', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h3 style={{ textAlign: 'center', margin: 0 }}>Live Network Topology</h3>
        <span style={{ 
          fontSize: '0.75rem', 
          padding: '0.25rem 0.75rem', 
          borderRadius: '1rem',
          backgroundColor: socketStatus === 'connected' ? '#166534' : '#991b1b',
          color: '#fff'
        }}>
          {socketStatus === 'connected' ? '🟢 Live' : socketStatus === 'disconnected' ? '🔴 Reconnecting...' : '🔴 Error'}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '3rem', flexWrap: 'wrap' }}>
        <NodeIcon icon={Activity} label="Node A (Sensors)" status={nodes.node_a} />
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ backgroundColor: '#2563eb', padding: '2rem', borderRadius: '1rem' }}>
            <Wifi color="#fff" size={48} />
          </div>
          <span style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>Wi-Fi 6 Router</span>
          <span style={{ color: '#60a5fa', fontSize: '0.8rem' }}>Center Hub</span>
        </div>

        <NodeIcon icon={Cpu} label="Node B (Actuators)" status={nodes.node_b} />
        <NodeIcon icon={Server} label="MQTT Server" status={nodes.server} />
      </div>
    </div>
  );
};

export default NetworkMap;