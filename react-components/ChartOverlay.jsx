import React, { useState, useEffect } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { io } from 'socket.io-client';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const socket = io();

const ChartOverlay = () => {
  const [chartData, setChartData] = useState({
    labels: [],
    datasets: []
  });

  const fetchData = async () => {
    try {
      const res = await fetch('/api/chart-data');
      const data = await res.json();
      
      if (!data || !data.temperature || !data.acEvents) {
        console.error("Invalid data format received:", data);
        return;
      }
      
      const labels = [];
      const tempPoints = [];
      const acPoints = [];
      
      // Parse dates once to avoid massive GC hangs inside the loops
      const parsedTemps = data.temperature.map(t => ({...t, timeMs: new Date(t.timestamp).getTime()}));
      const parsedAc = data.acEvents.map(a => ({...a, timeMs: new Date(a.timestamp).getTime()}));
      
      parsedTemps.forEach(t => {
        labels.push(new Date(t.timestamp).toLocaleTimeString());
        tempPoints.push(t.temp);
        
        // Find nearest AC event status
        let closestAc = { status: 0 };
        if (parsedAc.length > 0) {
          closestAc = parsedAc.reduce((prev, curr) => {
            return (Math.abs(curr.timeMs - t.timeMs) < Math.abs(prev.timeMs - t.timeMs) ? curr : prev);
          });
        }

        acPoints.push(closestAc ? closestAc.status : 0);
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
            yAxisID: 'y1'
          }
        ]
      });
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchData();
    let timeoutId;
    
    const handleUpdate = (data) => {
      // Whenever there is a new temperature reading or AC event, update chart
      if (data.topic === 'smartoffice/sensors' || data.topic === 'office/commands/node_b') {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fetchData(), 300);
      }
    };
    
    socket.on('sensor-update', handleUpdate);

    return () => {
      socket.off('sensor-update', handleUpdate);
      clearTimeout(timeoutId);
    };
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
