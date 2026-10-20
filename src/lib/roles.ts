// Back-office roles — safe to import from client components (no server deps).
// "TECHNICAL" is the original admin role (kept so existing accounts keep working);
// OPERATOR handles deposits and withdrawals only (no settings, no staff accounts).
export const ADMIN_ROLE = "TECHNICAL";
export const OPERATOR_ROLE = "OPERATOR";
export const STAFF_ROLES = [ADMIN_ROLE, OPERATOR_ROLE];
export const ROLE_LABEL: Record<string, string> = { TECHNICAL: "Admin", OPERATOR: "Operator", CLIENT: "Client" };

export const isStaffRole = (role: string | null | undefined) => !!role && STAFF_ROLES.includes(role);
