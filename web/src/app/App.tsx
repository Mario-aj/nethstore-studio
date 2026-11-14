import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { LoginPage } from '../features/auth/LoginPage';
import { LandingPage } from '../features/landing/LandingPage';
import { NotFoundPage } from './NotFoundPage';
import { queryClient } from './queryClient';
import { RequireAuth } from './RequireAuth';
import styles from './App.module.css';

const CreateBatchPage = lazy(() => import('../features/batch/CreateBatchPage'));
const BatchPage = lazy(() => import('../features/batch/BatchPage'));
const BatchesPage = lazy(() => import('../features/batch/BatchesPage'));

export function AppRoutes() {
  return (
    <Suspense fallback={<div className={styles.splash} />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/entrar" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/estudio" element={<CreateBatchPage />} />
          <Route path="/estudio/lotes" element={<BatchesPage />} />
          <Route path="/estudio/lotes/:id" element={<BatchPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export function App({ children }: { children?: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
        {children}
      </BrowserRouter>
    </QueryClientProvider>
  );
}
