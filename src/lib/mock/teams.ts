export type Team = {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  flagStyle: 'horizontal' | 'vertical';
};

export const teams: Team[] = [
  { id: 'brasil', name: 'Brasil', primary: '#009c3b', secondary: '#ffdf00', flagStyle: 'vertical' },
  { id: 'japon', name: 'Japón', primary: '#bc002d', secondary: '#ffffff', flagStyle: 'horizontal' },
  { id: 'argentina', name: 'Argentina', primary: '#74acdf', secondary: '#ffffff', flagStyle: 'horizontal' },
  { id: 'francia', name: 'Francia', primary: '#002395', secondary: '#ed2939', flagStyle: 'vertical' },
  { id: 'alemania', name: 'Alemania', primary: '#000000', secondary: '#ffce00', flagStyle: 'horizontal' },
  { id: 'espana', name: 'España', primary: '#c60b1e', secondary: '#ffc400', flagStyle: 'horizontal' },
  { id: 'mexico', name: 'México', primary: '#006847', secondary: '#ce1126', flagStyle: 'vertical' },
  { id: 'uruguay', name: 'Uruguay', primary: '#0038a8', secondary: '#ffffff', flagStyle: 'horizontal' },
  { id: 'inglaterra', name: 'Inglaterra', primary: '#ffffff', secondary: '#ce1124', flagStyle: 'vertical' },
  { id: 'portugal', name: 'Portugal', primary: '#006600', secondary: '#ff0000', flagStyle: 'vertical' },
  { id: 'colombia', name: 'Colombia', primary: '#fcd116', secondary: '#003893', flagStyle: 'horizontal' },
  { id: 'marruecos', name: 'Marruecos', primary: '#c1272d', secondary: '#006233', flagStyle: 'horizontal' },
];

export function getTeamById(id: string): Team | undefined {
  return teams.find((team) => team.id === id);
}
