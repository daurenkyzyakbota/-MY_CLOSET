'use client';

import { createPortal } from 'react-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { useEffect, useRef, useState } from 'react';

export function MyClosetClient({ shell }) {
  const mountRef = useRef(null);
  const [buttonHost, setButtonHost] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setButtonHost(mountRef.current?.querySelector('#add-item-root') ?? null);
    const runtimeScript = document.createElement('script');
    runtimeScript.type = 'module';
    runtimeScript.src = '/app.mjs';
    runtimeScript.onerror = () => setLoadError('Не удалось запустить MyCloset. Обновите страницу.');
    mountRef.current?.append(runtimeScript);
    return () => runtimeScript.remove();
  }, []);

  return (
    <>
      <div id="mycloset-app" className="container-fluid p-0" ref={mountRef} dangerouslySetInnerHTML={{ __html: shell }} />
      {buttonHost && createPortal(
        <Button
          id="add-item"
          data-action="add-item"
          variant="contained"
          disableElevation
          startIcon={<span aria-hidden="true" className="mui-add-icon">+</span>}
          sx={{
            minHeight: 44,
            px: 2,
            borderRadius: '11px',
            fontFamily: 'Manrope, Segoe UI, Arial, sans-serif',
            fontSize: 13,
            lineHeight: 1.45,
            backgroundColor: '#a95972',
            boxShadow: '0 4px 12px #ab5d7714',
            '&:hover': { backgroundColor: '#914862', boxShadow: '0 5px 16px #ab5d7724' }
          }}
        >
          Добавить вещь
        </Button>,
        buttonHost
      )}
      {loadError && <Alert severity="error" role="alert" sx={{ position: 'fixed', zIndex: 140, left: 16, right: 16, bottom: 20 }}>{loadError}</Alert>}
    </>
  );
}