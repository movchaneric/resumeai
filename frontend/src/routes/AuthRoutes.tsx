import { Link } from "react-router";
import { Screen } from "@/features/run/screens";

/** Placeholders until the auth ticket. Accounts don't exist yet. */
export function SignInRoute() {
  return (
    <Screen title="Sign in" status="Accounts are coming soon.">
      <Link to="/" className="self-start font-semibold text-accent underline">
        Enter as a guest
      </Link>
    </Screen>
  );
}

export function SignUpRoute() {
  return (
    <Screen title="Create an account" status="Accounts are coming soon.">
      <Link to="/" className="self-start font-semibold text-accent underline">
        Enter as a guest
      </Link>
    </Screen>
  );
}
