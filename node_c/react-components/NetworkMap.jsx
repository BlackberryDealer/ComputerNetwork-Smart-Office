import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Wifi, Server, Activity, Cpu } from 'lucide-react';

const socket = io();

const NetworkMap = () => {
  const [nodes, setNodes] = useState({
    server: 'online', // Always online if the dashboard is rendering
    node_a: 'offline', 
    node_b: 'offline', 
    node_c: 'online'  
  });

  // Use refs to store the timeout IDs so we can clear/reset them
  const timeouts = useRef({
    node_a: null,
    node_b: null
  });

  // Helper function to handle the 10-second heartbeat
  const markNodeActive = (nodeId) => {
    setNodes((prev) => ({ ...prev, [nodeId]: 'online' }));

    // Clear the existing countdown
    if (timeouts.current[nodeId]) {
      clearTimeout(timeouts.current[nodeId]);
    }

    // Start a fresh 15-second countdown to mark it offline
    timeouts.current[nodeId] = setTimeout(() => {
      setNodes((prev) => ({ ...prev, [nodeId]: 'offline' }));
    }, 15000);
  };

  useEffect(() => {
    // Initial fetch to get currently connected devices
    fetch('/api/nodes')
      .then(r => r.json())
      .then(data => {
        setNodes(prev => ({ ...prev, ...data }));
        // Start timers for any nodes fetched as 'online' 
        Object.keys(data).forEach(nodeId => {
          if (data[nodeId] === 'online' && nodeId !== 'server') {
            markNodeActive(nodeId);
          }
        });
      })
      .catch(console.error);

    socket.on('sensor-update', (data) => {
      if (!data.topic) return;

      // 1. Check for Node A activity (Sensor packets)
      if (data.topic.startsWith('smartoffice/sensors')) {
        markNodeActive('node_a');
      }

      // 2. Check for Node B activity (Heartbeat packets)
      if (data.topic.startsWith('smartoffice/status/node_b')) {
        markNodeActive('node_b');
      }

      // 3. Keep the original LWT (Last Will & Testament) logic just in case
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

    return () => {
      socket.off('sensor-update');
      // Cleanup all timeouts when the component unmounts
      Object.values(timeouts.current).forEach(clearTimeout);
    };
  }, []);

  const getNodeColor = (status) => status === 'online' ? '#22c55e' : '#ef4444';

  const NodeIcon = ({ icon: Icon, label, status }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 20px' }}>
      <div style={{
        backgroundColor: '#fff',
        padding: '1.5rem',
        borderRadius: '50%',
        boxShadow: `0 0 15px ${getNodeColor(status)}`,
        transition: 'box-shadow 0.3s, border-color 0.3s'
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