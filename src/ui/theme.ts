import { useColorScheme } from 'react-native';

const light = {
  background: '#FFFFFF',
  surface: '#F4F4F6',
  text: '#111114',
  textMuted: '#6B6B76',
  border: '#E3E3E8',
  accent: '#3A5BD9',
  danger: '#C2362F',
  disabled: '#B8B8C0',
};

export type Theme = typeof light;

const dark: Theme = {
  background: '#0E0E10',
  surface: '#1B1B1F',
  text: '#F2F2F5',
  textMuted: '#9C9CA6',
  border: '#2A2A30',
  accent: '#8AA2FF',
  danger: '#FF7A70',
  disabled: '#4A4A52',
};

/** App chrome follows the system appearance, like the sites we wrap do. */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
