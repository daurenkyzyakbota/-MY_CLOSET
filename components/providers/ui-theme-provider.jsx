'use client';

import { createTheme, ThemeProvider } from '@mui/material/styles';

const theme = createTheme({
  cssVariables: { colorSchemeSelector: "[data-theme='%s']" },
  colorSchemes: {
    light: {
      palette: {
        mode: 'light',
        primary: { main: '#a95972', dark: '#914862', light: '#efdee4', contrastText: '#ffffff' },
        secondary: { main: '#6e806c' },
        error: { main: '#a24f4f' },
        background: { default: '#fcfaf7', paper: '#fffdfb' },
        text: { primary: '#352d2f', secondary: '#75696b' },
        divider: '#eee9e6',
      },
    },
    dark: {
      palette: {
        mode: 'dark',
        primary: { main: '#e4a0c4', dark: '#c980a8', light: '#f4c3de', contrastText: '#251924' },
        secondary: { main: '#a9bfa6', contrastText: '#182017' },
        error: { main: '#eaa1a4', contrastText: '#2b1519' },
        background: { default: '#18151c', paper: '#241e29' },
        text: { primary: '#f1e7ef', secondary: '#baa8b8' },
        divider: '#443748',
      },
    },
  },
  typography: {
    fontFamily: 'var(--font-ui), Manrope, "Segoe UI", Arial, sans-serif',
    fontSize: 14,
    button: {
      textTransform: 'none',
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: 0,
      lineHeight: 1.5,
    },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true, disableRipple: true } },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => [
          {
            minHeight: 46,
            backgroundColor: '#fffefd',
            fontSize: 14,
            borderRadius: 10,
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#d4b5c2' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: '#b86b88',
              borderWidth: 1.5,
            },
          },
          theme.applyStyles('dark', {
            backgroundColor: theme.vars.palette.background.paper,
            color: theme.vars.palette.text.primary,
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#a97794' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.vars.palette.primary.main,
            },
          }),
        ],
        notchedOutline: ({ theme }) => [
          { borderColor: '#e5dedb' },
          theme.applyStyles('dark', { borderColor: theme.vars.palette.divider }),
        ],
      },
    },
    MuiDialog: { defaultProps: { maxWidth: false } },
    MuiBackdrop: {
      styleOverrides: {
        root: ({ theme }) => [
          { backgroundColor: '#281c296b', backdropFilter: 'blur(7px)' },
          theme.applyStyles('dark', { backgroundColor: '#0c090fc7' }),
        ],
      },
    },
    MuiAlert: { styleOverrides: { root: { fontSize: 13, lineHeight: 1.8, borderRadius: 10 } } },
  },
});

export default function UiThemeProvider({ children }) {
  return (
    <ThemeProvider
      theme={theme}
      defaultMode="system"
      modeStorageKey="mycloset-theme-mode"
      colorSchemeStorageKey="mycloset-theme-scheme"
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
