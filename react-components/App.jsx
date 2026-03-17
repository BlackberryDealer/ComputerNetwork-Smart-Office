import React from 'react';
import NetworkMap from './NetworkMap';
import Analytics from './Analytics';
import ChartOverlay from './ChartOverlay';
import ControlPanel from './ControlPanel';

const App = () => {
  return (
    <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <h1 style={{ color: '#1f2937' }}>Smart Office Dashboard</h1>
      
      {/* 1. Live Network Topology & Node Health Map */}
      <NetworkMap />

      {/* 2. "Energy Saved" & "Ghost Occupancy" Analytics */}
      <Analytics />

      {/* 3. Temperature vs. AC Utilization Overlay Chart */}
      <ChartOverlay />

      {/* 4. Interactive "Override" Control Panel */}
      <ControlPanel />
    </div>
  );
};

export default App;
