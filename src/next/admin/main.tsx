import React from 'react'
import ReactDOM from 'react-dom/client'
import 'antd/dist/reset.css'
import './style.css'
import App from './App'
import { configureApiSurface } from '@next/shared/api'

configureApiSurface('admin')
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
