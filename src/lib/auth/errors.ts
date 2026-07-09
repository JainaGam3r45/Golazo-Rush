type AuthErrorLike = {
  message?: string;
  statusCode?: number;
};

export function mapAuthError(error: AuthErrorLike | null | undefined, configured: boolean): string {
  if (!configured) {
    return 'El servicio de cuentas no está disponible en este momento.';
  }

  if (!error) {
    return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  }

  const message = (error.message ?? '').toLowerCase();

  if (error.statusCode === 401 || message.includes('invalid') || message.includes('credential')) {
    return 'Email o contraseña incorrectos.';
  }

  if (error.statusCode === 403 || message.includes('verified') || message.includes('verification')) {
    return 'Debes verificar tu email antes de iniciar sesión.';
  }

  if (message.includes('already') && message.includes('registered')) {
    return 'Ya existe una cuenta con ese email.';
  }

  if (message.includes('network') || message.includes('fetch') || message.includes('failed to fetch')) {
    return 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.';
  }

  if (message.includes('password') && (message.includes('short') || message.includes('weak'))) {
    return 'La contraseña no cumple los requisitos mínimos.';
  }

  return 'No se pudo completar la operación. Inténtalo de nuevo.';
}
