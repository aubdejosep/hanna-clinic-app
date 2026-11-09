// Small line-style brand marks for the Social Media card (Lucide has no brand icons).
const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

export const FacebookIcon = () => <svg {...base}><path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V9H6.5v3.5H9V21h3.5v-8.5H15l.5-3.5h-3V7a1 1 0 0 1 1-1H15z" /></svg>
export const XIcon = () => <svg {...base}><path d="M4 4l16 16M20 4L4 20" /></svg>
export const InstagramIcon = () => <svg {...base}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" /></svg>
export const TikTokIcon = () => <svg {...base}><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" /><path d="M14 3c.5 2.8 2.4 4.6 5 5" /></svg>
export const ViberIcon = () => <svg {...base}><path d="M12 3c5 0 8 2.5 8 7.5S17 18 12 18l-3 3v-3.4C5.8 16.5 4 14 4 10.5 4 5.5 7 3 12 3z" /><path d="M9.5 8.5c.3 2 1.9 3.6 4 4l1-1 1.5.8" /></svg>
export const WhatsAppIcon = () => <svg {...base}><path d="M4 20l1.3-3.8A8 8 0 1 1 8 19z" /><path d="M9 9.5c.4 2 2 3.6 4.5 4.5l1.2-1.2 1.6.8" /></svg>
