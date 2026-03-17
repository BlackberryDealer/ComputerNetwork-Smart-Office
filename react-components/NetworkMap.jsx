import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Wifi, Server, Activity, Cpu } from 'lucide-react';

const socket = io();

const NetworkMap = () => {
  const [nodes, setNodes] = useState({
    server: 'online',
    node_a: 'offline', // Sensors
    node_b: 'offline', // Actuators
    node_c: 'offline'
  });

  useEffect(() => {
    // Initial fetch to get currently connected devices
    fetch('/api/nodes')
      .then(r => r.json())
      .then(data => {
        setNodes(prev => ({ ...prev, ...data }));
      })
      .catch(console.error);

    socket.on('sensor-update', (data) => {
      // Listen for LWT messages under 'smartoffice/status/+'
      if (data.topic && data.topic.startsWith('smartoffice/status/')) {
        const nodeId = data.topic.split('/').pop();
        if (data.payload && data.payload.status) {
          setNodes(prev => ({
            ...prev,
            [nodeId]: data.payload.status
          }));
        }
      }
    });

    return () => socket.off('sensor-update');
  }, []);

  const getNodeColor = (status) => status === 'online' ? '#22c55e' : '#ef4444';

  const NodeIcon = ({ icon: Icon, label, status }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 20px' }}>
      <div style={{
        backgroundColor: '#fff',
        padding: '1.5rem',
        borderRadius: '50%',
        boxShadow: `0 0 15px ${getNodeColor(status)}`,
        transition: 'box-shadow 0.3s'
      }}>
        <Icon color={getNodeColor(status)} size={40} />
      </div>
      <span style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>{label}</span>
      <span style={{ color: getNodeColor(status), fontSize: '0.8rem', textTransform: 'uppercase' }}>{status}</span>
    </div>
  );

  return (
    <div style={{ padding: '2rem', backgroundColor: '#1f2937', borderRadius: '1rem', color: '#fff' }}>
      <h3 style={{ textAlign: 'center', marginBottom: '2rem' }}>Live Network Topology</h3>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '3rem' }}>
        <NodeIcon icon={Activity} label="Node A (Sensors)" status={nodes.node_a} />
        
        {/* Router Context */ }
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
