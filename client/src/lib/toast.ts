import { toast as sonner } from "sonner";

export const toast = {
  success: (message: string, options?: Parameters<typeof sonner.success>[1]) =>
    sonner.success(message, { duration: 2000, ...options }),
  error: (message: string, options?: Parameters<typeof sonner.error>[1]) =>
    sonner.error(message, { duration: 4000, ...options }),
  loading: (message: string, options?: Parameters<typeof sonner.loading>[1]) =>
    sonner.loading(message, options),
  dismiss: (id?: string) => sonner.dismiss(id),
};
