import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './style.css'
import { configureApiSurface } from '@next/shared/api'

configureApiSurface('mobile')
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
