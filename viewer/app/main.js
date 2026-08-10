import { configureApp } from './core/app.js';
import { TVTIME_APP } from './tvtime.js';
import { initLanding } from './ui/landing.js';

configureApp(TVTIME_APP);
initLanding();   // module scripts run after parsing; no DOMContentLoaded needed
