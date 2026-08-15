import { ref } from 'vue';

export function useAsyncTask() {
  const loading = ref(false);
  const error = ref('');

  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (loading.value) return undefined;
    loading.value = true;
    error.value = '';
    try {
      return await task();
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '操作失败，请稍后重试';
      return undefined;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, run };
}
