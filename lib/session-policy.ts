export const sessionPolicy = {
  expiresIn: 60 * 60 * 24 * 30,
  updateAge: 60 * 60,
};

export const clientSessionPolicy = {
  refetchInterval: 60 * 5,
  refetchOnWindowFocus: true,
  refetchWhenOffline: false,
};
