import { StatusBadge } from "../ui/status-badge";

export default function DocumentStatusBadge() {
  return (
    <StatusBadge
      status="available"
      primaryText="Saved"
      size="xs"
      variant="outline"
      animated={false}
      className="shrink-0 border-status-saved/30 bg-status-savedSoft text-status-saved"
    />
  );
}
