export type CheckDatabase = () => Promise<void>;

export function createHealthService(checkDatabase: CheckDatabase) {
  return {
    async check() {
      await checkDatabase();
      return { status: 'ok', database: 'up' } as const;
    },
  };
}
