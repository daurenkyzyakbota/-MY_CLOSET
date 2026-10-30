'use client';

import { forwardRef } from 'react';
import Button from '@mui/material/Button';

/** Keeps the existing button design and native form behavior on Material UI. */
export const AppButton = forwardRef(function AppButton(
  {
    className = '',
    type = 'button',
    variant,
    color,
    disableRipple = true,
    disableElevation = true,
    hidden,
    style,
    children,
    ...props
  },
  ref,
) {
  const classes = new Set(className.split(/\s+/).filter(Boolean));
  const danger = classes.has('btn-danger') || classes.has('button-danger');
  const primary = classes.has('btn-primary') || classes.has('button-primary');
  const secondary = classes.has('btn-secondary') || classes.has('button-secondary');
  const appearance = variant || (primary ? 'contained' : danger || secondary ? 'outlined' : 'text');
  return (
    <Button
      {...props}
      ref={ref}
      type={type}
      className={`app-button ${className}`.trim()}
      variant={appearance}
      color={color || (danger ? 'error' : 'primary')}
      disableRipple={disableRipple}
      disableElevation={disableElevation}
      hidden={hidden}
      style={hidden ? { ...style, display: 'none' } : style}
    >
      {children}
    </Button>
  );
});

export default AppButton;
