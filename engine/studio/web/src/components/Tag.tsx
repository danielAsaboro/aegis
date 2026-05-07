import { RoughOval } from '../lib/rough';

type Props = {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  fill?: string;
};

export function Tag({ active = false, onClick, children, fill = 'var(--paper-edge)' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`transition-transform ${active ? 'scale-105' : 'opacity-70 hover:opacity-100'}`}
    >
      <RoughOval fill={active ? 'var(--butter)' : fill}>
        <span className="font-display text-sm">{children}</span>
      </RoughOval>
    </button>
  );
}
