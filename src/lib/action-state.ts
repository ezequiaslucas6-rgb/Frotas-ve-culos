/** Estado retornado pelas Server Actions usadas com useActionState. */
export type ActionState<T = undefined> =
  | { status: 'idle' }
  | { status: 'success'; message: string; data?: T }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string[]> };

export const idle: ActionState = { status: 'idle' };

export const fail = (message: string, fieldErrors?: Record<string, string[]>): ActionState<never> => ({
  status: 'error',
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

export const ok = <T = undefined>(message: string, data?: T): ActionState<T> => ({
  status: 'success',
  message,
  ...(data !== undefined ? { data } : {}),
});
