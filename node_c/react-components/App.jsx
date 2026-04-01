import React from 'react';
import ErrorBoundary from './ErrorBoundary';
import NetworkMap from './NetworkMap';
import Analytics from './Analytics';
import ChartOverlay from './ChartOverlay';
import ControlPanel from './ControlPanel';

const App = () => {
  return (
    <ErrorBoundary>
      <div style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        <h1 style={{ color: '#1f2937' }}>Smart Office Dashboard</h1>
        
        {/* 1. Live Network Topology & Node Health Map */}
        <ErrorBoundary>
          <NetworkMap />
        </ErrorBoundary>

        {/* 2. "Energy Saved" & "Ghost Occupancy" Analytics */}
        <ErrorBoundary>
          <Analytics />
        </ErrorBoundary>

        {/* 3. Temperature vs. AC Utilization Overlay Chart */}
        <ErrorBoundary>
          <ChartOverlay />
        </ErrorBoundary>

        {/* 4. Interactive "Override" Control Panel */}
        <ErrorBoundary>
          <ControlPanel />
        </ErrorBoundary>
      </div>
    </ErrorBoundary>
  );
};

export default App;
