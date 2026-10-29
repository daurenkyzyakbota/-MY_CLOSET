'use client';

import { createTheme, ThemeProvider } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#a95972', dark: '#914862', contrastText: '#fff' },
    background: { default: '#fcfaf7', paper: '#fff' },
    text: { primary: '#352d2f', secondary: '#75696b' }
  },
  typography: {
    fontFamily: 'Manrope, Segoe UI, Arial, sans-serif',
    button: { fontWeight: 600, textTransform: 'none' }
  },
  shape: { borderRadius: 11 }
});

export function ThemeRegistry({ children }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}