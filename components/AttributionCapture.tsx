'use client';

import { useEffect } from 'react';
import { captureSignupAttribution } from '@/lib/signup-attribution';

// In de root-layout gemount zodat élke landingspagina (o.a. /pro,
// /rijschool-planner) de first-touch-herkomst vastlegt. Rendert niets.
export default function AttributionCapture() {
  useEffect(() => {
    captureSignupAttribution();
  }, []);
  return null;
}
