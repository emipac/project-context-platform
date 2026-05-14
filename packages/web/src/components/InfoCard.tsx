export function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="info-card">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
