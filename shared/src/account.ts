import { z } from "zod";

/** The signed-in person, as `GET /account` returns them. `image` is the Google avatar URL, `null` for a password Account. */
export const AccountSchema = z.object({
  accountId: z.string().min(1),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});
export type Account = z.infer<typeof AccountSchema>;
