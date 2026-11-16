import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ChakraProvider, ColorModeScript } from '@chakra-ui/react';
import theme from './theme';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import './styles/feedback.css';
import OfflineOverlay from './components/OfflineOverlay';
import { registerOfflineSupport } from './utils/registerOfflineSupport';

registerOfflineSupport();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ChakraProvider theme={theme}>
        <ColorModeScript initialColorMode={theme.config.initialColorMode} />
        <App />
        <OfflineOverlay />
      </ChakraProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
