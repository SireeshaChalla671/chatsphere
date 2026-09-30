'use client';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const l = localStorage.getItem('theme') === 'light';
    setLight(l);
    document.documentElement.classList.toggle('light', l);
  }, []);

  function toggle() {
    const l = !light;
    setLight(l);
    localStorage.setItem('theme', l ? 'light' : 'dark');
    document.documentElement.classList.toggle('light', l);
  }

  return (
    <button onClick={toggle} className="text-xs text-slate-400 hover:text-white">
      {light ? 'Dark' : 'Light'}
    </button>
  );
}
