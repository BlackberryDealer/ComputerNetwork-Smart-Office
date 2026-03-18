import React, { useState, useEffect } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { io } from 'socket.io-client';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const socket = io();

const ChartOverlay = () => {
  // 1. Initialize with the proper structure so Chart.js doesn't crash on load
  const [chartData, setChartData] = useState({
    labels: [],
    datasets: [
      {
        label: 'Temperature (°C)',
        data: [],
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.5)',
        yAxisID: 'y'
      },
      {
        label: 'AC Status (0=OFF, 1=SLOW, 2=FAST)',
        data: [],
        borderColor: 'rgb(53, 162, 235)',
        backgroundColor: 'rgba(53, 162, 235, 0.5)',
        yAxisID: 'y1',
        stepped: true
      }
    ]
  });

  const fetchData = async () => {
    try {
      const res = await fetch('/api/chart-data');
      const data = await res.json();
      
      const labels = [];
      const tempPoints = [];
      const acPoints = [];
      
      // 2. Defensive coding: Fallback to empty arrays if data is undefined
      const safeAcEvents = data.acEvents || [];
      const safeTemperatures = data.temperature || [];

      // Sort AC events chronologically
      const sortedAcEvents = safeAcEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      safeTemperatures.forEach(t => {
        labels.push(new Date(t.timestamp).toLocaleTimeString());
        tempPoints.push(t.temp);
        
        // Find the most recent AC command that happened BEFORE or AT this exact temperature reading
        const pastAcEvents = sortedAcEvents.filter(ac => new Date(ac.timestamp) <= new Date(t.timestamp));
        
        // If we found previous events, take the status of the very last one. Otherwise, default to 0.
        const currentAcStatus = pastAcEvents.length > 0 ? pastAcEvents[pastAcEvents.length - 1].status : 0;

        acPoints.push(currentAcStatus);
      });

      setChartData({
        labels,
        datasets: [
          {
            label: 'Temperature (°C)',
            data: tempPoints,
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.5)',
            yAxisID: 'y'
          },
          {
            label: 'AC Status (0=OFF, 1=SLOW, 2=FAST)',
            data: acPoints,
            borderColor: 'rgb(53, 162, 235)',
            backgroundColor: 'rgba(53, 162, 235, 0.5)',
            yAxisID: 'y1',
            stepped: true 
          }
        ]
      });
    } catch (e) {
      console.error("Failed to fetch or parse chart data:", e);
    }
  };

  useEffect(() => {
    fetchData();
    socket.on('sensor-update', (data) => {
      // Whenever there is a new temperature reading or AC event, update chart
      if (data.topic === 'smartoffice/sensors' || data.topic === 'office/commands/node_b') {
        fetchData();
      }
    });

    return () => socket.off('sensor-update');
  }, []);

  const options = {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    stacked: false,
    plugins: {
      title: { display: true, text: 'Temperature vs AC Utilization' }
    },
    scales: {
      y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Temperature (°C)' } },
      y1: { type: 'linear', display: true, position: 'right', min: 0, max: 2, ticks: { stepSize: 1 }, grid: { drawOnChartArea: false }, title: { display: true, text: 'AC Status' } }
    }
  };

  return (
    <div style={{ padding: '1rem', backgroundColor: '#fff', borderRadius: '1rem', marginTop: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
      <Line options={options} data={chartData} />
    </div>
  );
};

export default ChartOverlay;