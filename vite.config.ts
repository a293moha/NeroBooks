import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this app from a /NeroBooks/ subpath, so asset URLs
// need that prefix there. Vercel (and local dev) serve from the domain
// root, so base must be '/' there instead — using the wrong one causes a
// blank page because the built HTML requests assets at paths that don't
// exist on that host. GITHUB_ACTIONS is set automatically by GitHub's
// runners, so this needs no manual configuration on either platform.
// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/NeroBooks/' : '/',
  plugins: [react()],
})
