import axios from "axios";
import { API_BASE_URL, API_TIMEOUT_MS } from "../lib/constants";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message = err.response?.data?.error?.message ?? err.message ?? "请求失败";
    return Promise.reject(new Error(message));
  },
);
