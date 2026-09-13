import axios from "axios";

/** Only an application rejection proves this financial command did not commit.
 * Timeouts/rate limits/auth loss may follow an earlier successful, lost response.
 * Retain the same receipt key until the server confirms or rejects that command.
 */
export function isDefinitiveSuspensionRejection(error: unknown): boolean {
  return axios.isAxiosError(error)
    && [400, 404, 409, 422].includes(error.response?.status ?? 0);
}
