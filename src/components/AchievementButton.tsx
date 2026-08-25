import { Medal, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAchievementStore } from '../stores/achievements';
import { useThemeStore } from '../stores/theme';
import { resolveThemeTemplate } from '../theme/defaultTemplates';
import { formatAchievementSeconds, normalizeAchievementTheme } from '../data/achievementManifest';

interface AchievementButtonProps {
  isPixel: boolean;
  isDark: boolean;
}

export default function AchievementButton({ isPixel, isDark }: AchievementButtonProps) {
  const { t } = useTranslation('shell');
  const profile = useAchievementStore((state) => state.profile);
  const definitions = useAchievementStore((state) => state.definitions);
  const summary = useAchievementStore((state) => state.summary);
  const openDrawer = useAchievementStore((state) => state.openDrawer);
  const { templateId, customTemplates, style } = useThemeStore();
  const currentTheme = useMemo(() => {
    const tpl = resolveThemeTemplate(templateId, customTemplates);
    return normalizeAchievementTheme(tpl.visuals?.style || style);
  }, [customTemplates, style, templateId]);
  const stats = profile?.themeStats?.[currentTheme] || {};
  const unlockedCount = summary?.unlockedCount ?? Object.keys(profile?.unlockedAchievements || {}).length;
  const totalCount = summary?.achievementCount ?? definitions.length;
  const currentThemeUnlocked = Object.values(profile?.unlockedAchievements || {}).filter(
    (item: any) => item.theme === currentTheme,
  ).length;
  const currentTime = formatAchievementSeconds(stats.activeSeconds || 0);
  const label = profile?.preferences?.showTopBadge === false
    ? t('achievement.label')
    : t('achievement.badge', { count: currentThemeUnlocked });

  return (
    <button
      type="button"
      onClick={() => openDrawer('overview')}
      className={
        isPixel
          ? 'px-btn px-btn--sm px-btn--yellow t8-achievement-button--pixel'
          : `t8-achievement-button flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
              isDark
                ? 'bg-yellow-500/10 border-yellow-400/35 text-yellow-200 hover:bg-yellow-500/20'
                : 'bg-yellow-50 border-yellow-300 text-yellow-800 hover:bg-yellow-100'
            }`
      }
      title={t('achievement.title', { time: currentTime, unlocked: unlockedCount, total: totalCount })}
    >
      <Trophy size={14} />
      <span className="text-[11px]">{t('achievement.label')}</span>
      <span className="t8-achievement-button__badge">
        <Medal size={11} />
        {label}
      </span>
    </button>
  );
}
