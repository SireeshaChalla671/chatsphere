import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ChatSphere',
    short_name: 'ChatSphere',
    description: 'Chat, voice and video calls',
    start_url: '/',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#059669',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
