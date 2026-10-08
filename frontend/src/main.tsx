// React root + provider stack.
//
// Design mapping ("Folder Layout": main.tsx mounts the React root, Router,
// QueryClientProvider, and ToastProvider). The providers wrap <App /> so every
// page can use React Query's useQuery/useMutation and the shared useToast hook:
//
//   BrowserRouter        → routing context for App's <Routes> (Req 1.1–1.3)
//     QueryClientProvider → React Query cache/polling/mutations (Dashboard)
//       ToastProvider     → shared error/completion notifications (both pages)
//         App             → route table + nav header

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './lib/toast';
import './index.css';
import App from './App.tsx';

// A single QueryClient for the app's lifetime.
const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
