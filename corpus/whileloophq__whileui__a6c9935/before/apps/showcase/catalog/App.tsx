import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  FlatList,
  Pressable,
  Modal,
  StatusBar,
  Platform,
  StyleSheet,
  Image,
  Alert as SystemAlert,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable, useUniwind } from 'uniwind';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import * as ExpoSplashScreen from 'expo-splash-screen';
import './global.css';
import { KeyboardDockScreen } from './keyboard-dock-screen';
import { FabScreen } from './fab-screen';

void ExpoSplashScreen.preventAutoHideAsync();
import {
  SignInForm,
  SignUpForm,
  ForgotPasswordForm,
  VerifyEmailForm,
  ResetPasswordForm,
  SocialConnections,
  UserMenu,
} from './templates/auth';
import { ProfileHeader, SettingsSection, SettingsItem, AccountCard } from './templates/profile';
import {
  FontProvider,
  PortalHost,
  ThemeBridge,
  MotionProvider,
  useMotionPolicy,
  useThemeBridge,
  type ThemeBridgeAdapter,
  type ThemeMode,
  type MotionMode,
  Text,
  Button,
  ButtonText,
  ButtonIcon,
  Input,
  NumericInput,
  Surface,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  FormField,
  FormLabel,
  FormControl,
  FormHint,
  FormMessage,
  LabeledField,
  LabeledFieldControl,
  Badge,
  BadgeText,
  Alert,
  AlertTitle,
  AlertDescription,
  Switch,
  Checkbox,
  Label,
  Separator,
  Progress,
  Spinner,
  Textarea,
  Skeleton,
  Stack,
  Row,
  DataRow,
  DataRowLeft,
  DataRowCenter,
  DataRowRight,
  DataRowLabel,
  DataRowDescription,
  DataRowValue,
  AspectRatio,
  Avatar,
  AvatarFallback,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Collapsible,
  Container,
  CollapsibleTrigger,
  CollapsibleContent,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectItemIcon,
  type SelectOption,
  Toggle,
  ToggleText,
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
  ToggleGroup,
  ToggleGroupItem,
  ToggleGroupItemText,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarSeparator,
  OTPInput,
  ToastProvider,
  ToastContainer,
  useToast,
  BottomNav,
  FloatingBottomNav,
  Header,
  HeaderBackButton,
  TabBar,
  DrawerMenu,
  AppShell,
  ActionBar,
  KeyboardAwareScreen,
  DockedInput,
  SmartInput,
  Chat,
  ChatMessageBubble,
  type ChatMessage,
  ConfirmActionSheet,
  ContentSkeleton,
  PageSkeleton,
  ScreenSkeleton,
  Sheet,
  SheetHeader,
  SheetContent,
  SheetFooter,
  SheetClose,
  EmptyState,
  ErrorBoundary,
  ErrorState,
  LoadingState,
  LoadingScreen,
  PullToRefreshScrollView,
  SplashScreen,
  FormModalScreen,
  ListItem,
  NotificationItem,
  TimelineFeed,
  ProductCard,
  PricingCard,
  CheckoutSummary,
  MetricCard,
  SubscriptionCard,
  FeatureGate,
  UsageBar,
  PlanToggle,
  UpgradeBanner,
  SmartImage,
  DatePickerModal,
  DatePickerTrigger,
  DatePickerInline,
  DateRangePickerModal,
  DateRangePickerTrigger,
  TimePickerModal,
  TimePickerTrigger,
  type DateRange,
  cn,
  focusRing,
  useIconColors,
} from '@thewhileloop/whileui';
import { CodeBlock } from '@thewhileloop/whileui/code';
import { Markdown } from '@thewhileloop/whileui/markdown';

type CategoryKey =
  | 'primitives'
  | 'controls'
  | 'overlays'
  | 'forms'
  | 'auth'
  | 'navigation'
  | 'layout'
  | 'chat'
  | 'profile'
  | 'lists'
  | 'commerce';

const categories: { key: CategoryKey; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'primitives', label: 'All Components', icon: 'box' },
  { key: 'controls', label: 'Controls', icon: 'sliders' },
  { key: 'overlays', label: 'Overlays', icon: 'layers' },
  { key: 'forms', label: 'Forms', icon: 'edit-3' },
  { key: 'auth', label: 'Auth', icon: 'lock' },
  { key: 'navigation', label: 'Navigation', icon: 'compass' },
  { key: 'layout', label: 'Layout', icon: 'layout' },
  { key: 'chat', label: 'Chat', icon: 'message-circle' },
  { key: 'profile', label: 'Profile', icon: 'user' },
  { key: 'lists', label: 'Lists', icon: 'list' },
  { key: 'commerce', label: 'Commerce', icon: 'shopping-bag' },
];

const triggerHaptic = (type: 'light' | 'medium' | 'selection' = 'light') => {
  if (Platform.OS === 'web') return;
  switch (type) {
    case 'light':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case 'medium':
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'selection':
      void Haptics.selectionAsync();
      break;
  }
};

const darkBackdropImg = require('./assets/dark-backdrop.jpg');
const lightBackdropImg = require('./assets/light-backdrop.jpg');

function parseBackdropNumber(value: string | number | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveBackdropColor(value: string | number | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function resolveBackdropPresentation(
  dark: boolean,
  isAndroid: boolean,
  tokens: (string | number | undefined)[]
) {
  const [baseToken, imageOpacityToken, imageBlurToken, tintToken, veilToken] = tokens;
  const configuredImageOpacity = Math.max(
    0,
    Math.min(1, parseBackdropNumber(imageOpacityToken, dark ? 0.75 : 0.85))
  );
  const configuredImageBlurRadius = Math.max(
    0,
    Math.round(parseBackdropNumber(imageBlurToken, dark ? 12 : 8))
  );
  return {
    source: dark ? darkBackdropImg : lightBackdropImg,
    base: resolveBackdropColor(baseToken, dark ? 'rgba(31, 28, 36, 1)' : 'rgba(254, 251, 251, 1)'),
    imageOpacity: isAndroid ? configuredImageOpacity * 0.3 : configuredImageOpacity,
    imageBlurRadius: isAndroid
      ? Math.min(configuredImageBlurRadius, dark ? 4 : 2)
      : configuredImageBlurRadius,
    tint: resolveBackdropColor(
      tintToken,
      dark
        ? isAndroid
          ? 'rgba(236, 72, 153, 0.01)'
          : 'rgba(236, 72, 153, 0.02)'
        : isAndroid
          ? 'rgba(219, 39, 119, 0.005)'
          : 'rgba(219, 39, 119, 0.01)'
    ),
    veil: resolveBackdropColor(
      veilToken,
      dark
        ? isAndroid
          ? 'rgba(18, 14, 23, 0.6)'
          : 'rgba(18, 14, 23, 0.35)'
        : isAndroid
          ? 'rgba(254, 251, 251, 0.58)'
          : 'rgba(254, 251, 251, 0.25)'
    ),
  };
}

function ThemedBackdrop() {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const isAndroid = Platform.OS === 'android';
  const tokens = useCSSVariable([
    '--ui-showcase-backdrop-base',
    '--ui-showcase-backdrop-image-opacity',
    '--ui-showcase-backdrop-image-blur',
    '--ui-showcase-backdrop-tint',
    '--ui-showcase-backdrop-veil',
  ]);

  const presentation = resolveBackdropPresentation(dark, isAndroid, tokens);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: presentation.base,
          },
        ]}
      />
      <Image
        source={presentation.source}
        resizeMode="cover"
        blurRadius={presentation.imageBlurRadius}
        // Width and height stay explicit because `absoluteFill` alone leaves the web
        // image at its intrinsic dimensions on a wide viewport.
        style={[
          StyleSheet.absoluteFill,
          { opacity: presentation.imageOpacity, width: '100%', height: '100%' },
        ]}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: presentation.tint,
          },
        ]}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: presentation.veil,
          },
        ]}
      />
    </View>
  );
}

const showcaseThemeStore: { mode: ThemeMode | null } = { mode: null };

const showcaseThemeAdapter: ThemeBridgeAdapter = {
  loadThemeMode: async () => showcaseThemeStore.mode,
  saveThemeMode: async (mode) => {
    showcaseThemeStore.mode = mode;
  },
};

const SHOWCASE_FONT_MAP = {
  'font-normal': 'PlusJakartaSans_400Regular',
  'font-medium': 'PlusJakartaSans_500Medium',
  'font-semibold': 'PlusJakartaSans_600SemiBold',
  'font-bold': 'PlusJakartaSans_700Bold',
  'font-extrabold': 'PlusJakartaSans_800ExtraBold',
};

const TAB_BAR_ITEMS = [
  { key: 'all', label: 'All' },
  { key: 'following', label: 'Following' },
  { key: 'popular', label: 'Trending' },
  { key: 'recent', label: 'New' },
];

const EXAMPLE_CHAT_MESSAGE: ChatMessage = {
  id: 'example',
  role: 'assistant',
  content:
    'I can help with summaries, explanations, translations, and more. Try a suggestion below or type your own question.',
  secondary: 'Example message',
  contentSize: 'default',
};

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void ExpoSplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <FontProvider value={SHOWCASE_FONT_MAP}>
        <MotionProvider>
          <ToastProvider>
            <AppContent />
            <PortalHost />
          </ToastProvider>
        </MotionProvider>
      </FontProvider>
    </SafeAreaProvider>
  );
}

function MotionPolicyDetails() {
  const motion = useMotionPolicy();
  return (
    <View className="gap-1 rounded-xl border border-border bg-muted p-3">
      <Text className="text-sm text-foreground">Resolved mode: {motion.mode}</Text>
      <Text className="text-sm text-muted-foreground">
        Reduced: {motion.reduceMotion ? 'yes' : 'no'} · animations:{' '}
        {motion.animationsEnabled ? 'enabled' : 'disabled'}
      </Text>
      <Text className="text-sm text-muted-foreground">
        Durations: {motion.durations.fast}/{motion.durations.normal}/{motion.durations.slow} ms
      </Text>
    </View>
  );
}

function MotionPolicyDemo() {
  const [mode, setMode] = useState<MotionMode>('system');
  return (
    <MotionProvider mode={mode}>
      <SegmentedControl value={mode} onValueChange={(next) => setMode(next as MotionMode)} wrap>
        <SegmentedControlItem value="system">
          <SegmentedControlItemText>System</SegmentedControlItemText>
        </SegmentedControlItem>
        <SegmentedControlItem value="reduced">
          <SegmentedControlItemText>Reduced</SegmentedControlItemText>
        </SegmentedControlItem>
        <SegmentedControlItem value="full">
          <SegmentedControlItemText>Full</SegmentedControlItemText>
        </SegmentedControlItem>
        <SegmentedControlItem value="disabled">
          <SegmentedControlItemText>Disabled</SegmentedControlItemText>
        </SegmentedControlItem>
      </SegmentedControl>
      <MotionPolicyDetails />
    </MotionProvider>
  );
}

type ShowcaseIconColors = ReturnType<typeof useIconColors>;
type ShowcaseCategory = (typeof categories)[number];
type ShowcaseDemoScreen = 'keyboard' | 'fab' | null;

function toDrawerItem(
  category: ShowcaseCategory,
  activeKey: CategoryKey,
  colors: ShowcaseIconColors
) {
  return {
    key: category.key,
    label: category.label,
    icon: (
      <Feather
        name={category.icon}
        size={20}
        color={activeKey === category.key ? colors.primary : colors.muted}
      />
    ),
  };
}

function createShowcaseDrawerSections(activeKey: CategoryKey, colors: ShowcaseIconColors) {
  return [
    {
      title: 'Components',
      items: categories.slice(0, 4).map((item) => toDrawerItem(item, activeKey, colors)),
    },
    {
      title: 'Blocks',
      items: categories.slice(4).map((item) => toDrawerItem(item, activeKey, colors)),
    },
  ];
}

function CategoryPill({
  category,
  active,
  onSelect,
  colors,
}: {
  category: ShowcaseCategory;
  active: boolean;
  onSelect: (key: CategoryKey) => void;
  colors: ShowcaseIconColors;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-pressed={active}
      onPress={() => onSelect(category.key)}
      className={cn(
        'flex-row items-center gap-2 rounded-full px-4 py-2.5',
        focusRing,
        active ? 'bg-primary' : 'bg-muted'
      )}
    >
      <Feather
        aria-hidden
        name={category.icon}
        size={14}
        color={active ? colors.primaryForeground : colors.muted}
      />
      <Text
        className={cn(
          'text-sm font-medium',
          active ? 'text-primary-foreground' : 'text-muted-foreground'
        )}
      >
        {category.label}
      </Text>
    </Pressable>
  );
}

function CategoryStrip({
  activeKey,
  onSelect,
  colors,
}: {
  activeKey: CategoryKey;
  onSelect: (key: CategoryKey) => void;
  colors: ShowcaseIconColors;
}) {
  const renderItem = React.useCallback(
    ({ item }: { item: ShowcaseCategory }) => (
      <CategoryPill
        category={item}
        active={activeKey === item.key}
        onSelect={onSelect}
        colors={colors}
      />
    ),
    [activeKey, colors, onSelect]
  );
  return (
    <FlatList
      horizontal
      data={categories}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}
    />
  );
}

function ShowcaseCategoryContent({
  activeKey,
  themeMode,
  onThemeModeChange,
  onOpenKeyboardScreen,
  onOpenFabScreen,
}: {
  activeKey: CategoryKey;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  onOpenKeyboardScreen: () => void;
  onOpenFabScreen: () => void;
}) {
  const content: Partial<Record<CategoryKey, React.ReactNode>> = {
    primitives: <PrimitivesTab themeMode={themeMode} onThemeModeChange={onThemeModeChange} />,
    controls: <ControlsTab onOpenFabScreen={onOpenFabScreen} />,
    overlays: <OverlaysTab />,
    forms: <FormsBlocksTab />,
    auth: <AuthBlocksTab />,
    navigation: <NavigationBlocksTab />,
    layout: <LayoutBlocksTab onOpenKeyboardScreen={onOpenKeyboardScreen} />,
    profile: <ProfileBlocksTab />,
    lists: <ListsBlocksTab />,
    commerce: <CommerceBlocksTab />,
  };
  return content[activeKey] ?? content.primitives;
}

function AppContent() {
  const { theme } = useUniwind();
  const insets = useSafeAreaInsets();
  const {
    mode: themeMode,
    setMode: setThemeMode,
    cycleMode,
  } = useThemeBridge({
    adapter: showcaseThemeAdapter,
    initialMode: 'system',
  });
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState<CategoryKey>('primitives');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [demoScreen, setDemoScreen] = useState<ShowcaseDemoScreen>(null);
  const colors = useIconColors();

  if (showSplash) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1 }} className="bg-background">
          <ThemedBackdrop />
          <StatusBar barStyle={theme === 'light' ? 'dark-content' : 'light-content'} />
          <SplashScreen
            logo={
              <View className="h-24 w-24 rounded-3xl bg-primary items-center justify-center">
                <Feather name="zap" size={48} color={colors.primaryForeground} />
              </View>
            }
            appName="WhileUI"
            tagline="Beautiful native components"
            variant="scale"
            duration={1500}
            showLoading
            onAnimationComplete={() => {
              setTimeout(() => setShowSplash(false), 800);
            }}
          />
        </View>
      </SafeAreaProvider>
    );
  }

  if (activeTab === 'chat') {
    return (
      <SafeAreaProvider>
        <ThemeBridge mode={themeMode} adapter={showcaseThemeAdapter} />
        <View style={{ flex: 1 }} className="bg-background">
          <ThemedBackdrop />
          <StatusBar barStyle={theme === 'light' ? 'dark-content' : 'light-content'} />
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
            <ChatBlocksTab
              onBack={() => {
                triggerHaptic('light');
                setActiveTab('primitives');
              }}
              onMenuPress={() => {
                triggerHaptic('light');
                setDrawerOpen(true);
              }}
              colors={colors}
            />
          </SafeAreaView>
          <ToastContainer position="top" className="mt-12" />
          <DrawerMenu
            visible={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            sections={[
              {
                title: 'Back',
                items: [
                  {
                    key: 'components',
                    label: 'Back to Showcase',
                    icon: <Feather name="arrow-left" size={20} color={colors.muted} />,
                  },
                ],
              },
              {
                title: 'Other Blocks',
                items: categories
                  .filter((category) => category.key !== 'chat')
                  .map((category) => toDrawerItem(category, activeTab, colors)),
              },
            ]}
            activeKey={activeTab}
            onSelect={(key) => {
              setActiveTab(key as CategoryKey);
              setDrawerOpen(false);
            }}
            header={
              <View className="flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-xl bg-primary items-center justify-center">
                  <Text className="text-primary-foreground font-bold">W</Text>
                </View>
                <View>
                  <Text className="font-bold text-foreground text-lg">WhileUI</Text>
                  <Text className="text-xs text-muted-foreground">v1.0</Text>
                </View>
              </View>
            }
            footer={
              <Text className="text-xs text-muted-foreground text-center">
                Built with ❤️ for React Native
              </Text>
            }
          />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeBridge mode={themeMode} adapter={showcaseThemeAdapter} />
      <View style={{ flex: 1 }} className="bg-background">
        <ThemedBackdrop />
        <StatusBar barStyle={theme === 'light' ? 'dark-content' : 'light-content'} />
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          <View className="flex-1 web:max-w-4xl web:w-full web:self-center">
            <View className="px-5 pt-4 pb-2">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open menu"
                    testID="open-menu-test"
                    onPress={() => {
                      triggerHaptic('light');
                      setDrawerOpen(true);
                    }}
                    className={cn(
                      'w-10 h-10 rounded-xl bg-muted items-center justify-center active:opacity-70',
                      focusRing
                    )}
                  >
                    <Feather name="menu" size={20} color={colors.foreground} />
                  </Pressable>
                  <View>
                    <Text className="text-3xl font-bold text-foreground">WhileUI</Text>
                    <Text className="text-base text-muted-foreground">
                      Beautiful native components
                    </Text>
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change theme"
                  onPress={() => {
                    triggerHaptic('medium');
                    cycleMode();
                  }}
                  className={cn(
                    'w-10 h-10 rounded-xl bg-secondary items-center justify-center active:opacity-70',
                    focusRing
                  )}
                >
                  <Feather
                    name={themeMode === 'system' ? 'monitor' : theme === 'light' ? 'moon' : 'sun'}
                    size={18}
                    color={colors.foreground}
                  />
                </Pressable>
              </View>
            </View>

            <View className="mt-3 mb-3">
              <CategoryStrip
                activeKey={activeTab}
                colors={colors}
                onSelect={(key) => {
                  triggerHaptic('selection');
                  setActiveTab(key);
                }}
              />
            </View>

            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1 }}
            >
              <View
                style={{
                  paddingBottom: Math.max(40, insets.bottom + 24),
                  paddingHorizontal: 20,
                  flexGrow: 1,
                }}
              >
                <ShowcaseCategoryContent
                  activeKey={activeTab}
                  themeMode={themeMode}
                  onThemeModeChange={setThemeMode}
                  onOpenKeyboardScreen={() => setDemoScreen('keyboard')}
                  onOpenFabScreen={() => setDemoScreen('fab')}
                />
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
        <ToastContainer position="top" className="mt-12" />

        <DrawerMenu
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          sections={createShowcaseDrawerSections(activeTab, colors)}
          activeKey={activeTab}
          onSelect={(key) => {
            setActiveTab(key as CategoryKey);
            setDrawerOpen(false);
          }}
          header={
            <View className="flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-xl bg-primary items-center justify-center">
                <Text className="text-primary-foreground font-bold">W</Text>
              </View>
              <View>
                <Text className="font-bold text-foreground text-lg">WhileUI</Text>
                <Text className="text-xs text-muted-foreground">v1.0</Text>
              </View>
            </View>
          }
          footer={
            <Text className="text-xs text-muted-foreground text-center">
              Built with ❤️ for React Native
            </Text>
          }
        />
        {demoScreen === 'keyboard' ? (
          <View style={[StyleSheet.absoluteFill, { zIndex: 20 }]} className="bg-background">
            <KeyboardDockScreen onClose={() => setDemoScreen(null)} />
          </View>
        ) : null}
        {demoScreen === 'fab' ? (
          <View style={[StyleSheet.absoluteFill, { zIndex: 20 }]} className="bg-background">
            <FabScreen onClose={() => setDemoScreen(null)} />
          </View>
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}

function SectionGroup({ label }: { label: string }) {
  return (
    <View className="mb-4 mt-6">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
    </View>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-10">
      <View className="mb-4">
        <Text className="text-lg font-semibold text-foreground">{title}</Text>
        {subtitle && <Text className="text-sm text-muted-foreground mt-0.5">{subtitle}</Text>}
      </View>
      <View className="gap-4">{children}</View>
    </View>
  );
}

function PrimitivesTab({
  themeMode,
  onThemeModeChange,
}: {
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
}) {
  const [progress, setProgress] = useState(45);
  const [buttonPressCount, setButtonPressCount] = useState(0);
  const colors = useIconColors();

  React.useEffect(() => {
    const timer = setInterval(() => setProgress((p) => (p + 10) % 110), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View>
      <Section title="Typography" subtitle="Semantic type roles driven by visual tokens">
        <Text variant="eyebrow">Semantic roles</Text>
        <Text variant="heading">Build faster,{'\n'}ship beautiful.</Text>
        <Text variant="body" className="text-muted-foreground leading-relaxed">
          WhileUI gives you production-ready components that look stunning out of the box. Every
          component uses <Text className="font-semibold text-foreground">design tokens</Text> for
          effortless theming.
        </Text>
        <View className="flex-row flex-wrap gap-2 mt-1">
          <Badge>
            <BadgeText>React Native</BadgeText>
          </Badge>
          <Badge variant="secondary">
            <BadgeText>Expo</BadgeText>
          </Badge>
          <Badge variant="outline">
            <BadgeText>Uniwind</BadgeText>
          </Badge>
        </View>
      </Section>

      <Section title="Buttons" subtitle="6 variants × 4 sizes">
        <View className="flex-row flex-wrap gap-2">
          <Button>
            <ButtonText>Primary</ButtonText>
          </Button>
          <Button variant="secondary">
            <ButtonText>Secondary</ButtonText>
          </Button>
          <Button variant="destructive">
            <ButtonText>Destructive</ButtonText>
          </Button>
          <Button variant="outline">
            <ButtonText>Outline</ButtonText>
          </Button>
          <Button variant="ghost">
            <ButtonText>Ghost</ButtonText>
          </Button>
          <Button variant="link">
            <ButtonText>Link</ButtonText>
          </Button>
        </View>
        <View className="flex-row items-center gap-2">
          <Button size="sm">
            <ButtonText>Small</ButtonText>
          </Button>
          <Button size="default">
            <ButtonText>Default</ButtonText>
          </Button>
          <Button size="lg">
            <ButtonText>Large</ButtonText>
          </Button>
          <Button size="icon">
            <ButtonText>+</ButtonText>
          </Button>
        </View>
        <Text className="text-sm font-medium text-muted-foreground mt-2">With Icons</Text>
        <View className="flex-row flex-wrap gap-2">
          <Button>
            <ButtonIcon>
              <Feather name="download" size={16} color={colors.primaryForeground} />
            </ButtonIcon>
            <ButtonText>Download</ButtonText>
          </Button>
          <Button variant="outline">
            <ButtonIcon>
              <Feather name="settings" size={16} color={colors.foreground} />
            </ButtonIcon>
            <ButtonText>Settings</ButtonText>
          </Button>
          <Button variant="secondary">
            <ButtonText>Next</ButtonText>
            <ButtonIcon>
              <Feather name="arrow-right" size={16} color={colors.foreground} />
            </ButtonIcon>
          </Button>
          <Button size="icon" variant="outline" accessibilityLabel="Favourite">
            <Feather name="heart" size={18} color={colors.foreground} />
          </Button>
        </View>
        <View className="flex-row">
          <Button disabled>
            <ButtonText>Disabled</ButtonText>
          </Button>
          <Button loading className="ml-2">
            <ButtonText>Saving changes</ButtonText>
          </Button>
        </View>
        <Button
          variant="outline"
          testID="press-feedback-test"
          onPress={() => {
            setButtonPressCount((count) => count + 1);
            if (Platform.OS !== 'web') SystemAlert.alert('Button pressed');
          }}
          accessibilityLabel={`Press test: ${buttonPressCount}`}
        >
          <ButtonText>Press test: {buttonPressCount}</ButtonText>
        </Button>
      </Section>

      <Section title="Theme Bridge" subtitle="Official light/dark/system sync helper">
        <Text className="text-sm text-muted-foreground">
          Active mode: <Text className="text-foreground font-medium">{themeMode}</Text>
        </Text>
        <SegmentedControl
          value={themeMode}
          onValueChange={(next) => onThemeModeChange(next as ThemeMode)}
          wrap={false}
        >
          <SegmentedControlItem value="light">
            <SegmentedControlItemText>Light</SegmentedControlItemText>
          </SegmentedControlItem>
          <SegmentedControlItem value="dark">
            <SegmentedControlItemText>Dark</SegmentedControlItemText>
          </SegmentedControlItem>
          <SegmentedControlItem value="system">
            <SegmentedControlItemText>System</SegmentedControlItemText>
          </SegmentedControlItem>
        </SegmentedControl>
      </Section>

      <Section
        title="Motion Policy"
        subtitle="System, reduced, full, and deterministic disabled modes"
      >
        <MotionPolicyDemo />
      </Section>

      <Section
        title="Surfaces, Cards & Badges"
        subtitle="Three elevation levels, compound cards, and badges"
      >
        <View className="flex-row gap-3">
          <Surface level="base" padding="sm" className="flex-1">
            <Text variant="label">Base</Text>
          </Surface>
          <Surface level="raised" padding="sm" className="flex-1">
            <Text variant="label">Raised</Text>
          </Surface>
          <Surface level="overlay" padding="sm" className="flex-1">
            <Text variant="label">Overlay</Text>
          </Surface>
        </View>
        <Card>
          <CardHeader>
            <View className="flex-row items-center justify-between">
              <CardTitle>Team Activity</CardTitle>
              <Badge variant="success">
                <BadgeText>Live</BadgeText>
              </Badge>
            </View>
            <CardDescription>Your team completed 24 tasks this week.</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progress} />
          </CardContent>
          <CardFooter>
            <Button className="w-full">
              <ButtonText>View Dashboard</ButtonText>
            </Button>
          </CardFooter>
        </Card>

        <View className="flex-row gap-3">
          <Card padding="sm" className="flex-1">
            <Text className="text-sm font-medium text-foreground">`padding=\"sm\"`</Text>
            <Text className="text-xs text-muted-foreground mt-1">
              Dense cards for compact settings.
            </Text>
          </Card>
          <Card padding="lg" className="flex-1">
            <Text className="text-sm font-medium text-foreground">`padding=\"lg\"`</Text>
            <Text className="text-xs text-muted-foreground mt-1">
              Roomy layouts for onboarding and forms.
            </Text>
          </Card>
        </View>

        <Card unstyled padding="none" className="rounded-xl border border-border bg-card p-4">
          <Text className="text-sm font-medium text-foreground">Unstyled card shell</Text>
          <Text className="text-xs text-muted-foreground mt-1">
            Use your own spacing/layout for advanced compositions.
          </Text>
        </Card>

        <Separator />
        <View className="flex-row flex-wrap gap-2">
          <Badge>
            <BadgeText>Default</BadgeText>
          </Badge>
          <Badge variant="secondary">
            <BadgeText>Secondary</BadgeText>
          </Badge>
          <Badge variant="destructive">
            <BadgeText>Destructive</BadgeText>
          </Badge>
          <Badge variant="outline">
            <BadgeText>Outline</BadgeText>
          </Badge>
          <Badge variant="success">
            <BadgeText>Success</BadgeText>
          </Badge>
          <Badge variant="warning">
            <BadgeText>Warning</BadgeText>
          </Badge>
          <Badge variant="info">
            <BadgeText>Info</BadgeText>
          </Badge>
        </View>
      </Section>
    </View>
  );
}

const LONG_REGIONS = Array.from({ length: 40 }, (_, index) => `Region ${index + 1}`);

function ControlsTab({ onOpenFabScreen }: { onOpenFabScreen: () => void }) {
  const [radioVal, setRadioVal] = useState('option-1');
  const [massUnit, setMassUnit] = useState('kg');
  const [heightUnit, setHeightUnit] = useState('cm');
  const [selectVal, setSelectVal] = useState<SelectOption | undefined>(undefined);
  const [regionVal, setRegionVal] = useState<SelectOption | undefined>(undefined);
  const colors = useIconColors();
  const insets = useSafeAreaInsets();
  const contentInsets = {
    top: insets.top,
    bottom: Platform.select({ ios: insets.bottom, android: insets.bottom + 24 }),
    left: 12,
    right: 12,
  };

  return (
    <View>
      <Section
        title="FAB"
        subtitle="A floating action button only behaves like itself over a full screen"
      >
        <Button onPress={onOpenFabScreen}>
          <ButtonText>Open the FAB screen</ButtonText>
        </Button>
      </Section>
      <Section title="Selection" subtitle="SegmentedControl, radios, selects, and toggles">
        <SegmentedControl value={massUnit} onValueChange={setMassUnit} wrap={false}>
          <SegmentedControlItem value="kg">
            <SegmentedControlItemText>kg</SegmentedControlItemText>
          </SegmentedControlItem>
          <SegmentedControlItem value="lbs">
            <SegmentedControlItemText>lbs</SegmentedControlItemText>
          </SegmentedControlItem>
        </SegmentedControl>
        <SegmentedControl value={heightUnit} onValueChange={setHeightUnit} wrap={false}>
          <SegmentedControlItem value="cm">
            <SegmentedControlItemText>Centimeters</SegmentedControlItemText>
          </SegmentedControlItem>
          <SegmentedControlItem value="in">
            <SegmentedControlItemText>Inches</SegmentedControlItemText>
          </SegmentedControlItem>
          <SegmentedControlItem value="ft">
            <SegmentedControlItemText>Feet</SegmentedControlItemText>
          </SegmentedControlItem>
        </SegmentedControl>
        <View>
          <Text className="mb-2 text-sm text-muted-foreground">Pill variant</Text>
          <SegmentedControl
            variant="pill"
            value={massUnit}
            onValueChange={setMassUnit}
            wrap={false}
          >
            <SegmentedControlItem value="kg">
              <SegmentedControlItemText>kg</SegmentedControlItemText>
            </SegmentedControlItem>
            <SegmentedControlItem value="lbs">
              <SegmentedControlItemText>lbs</SegmentedControlItemText>
            </SegmentedControlItem>
          </SegmentedControl>
        </View>
        <RadioGroup value={radioVal} onValueChange={setRadioVal}>
          <View className="flex-row items-center gap-2">
            <RadioGroupItem value="option-1" accessibilityLabel="Free plan" />
            <Label onPress={() => setRadioVal('option-1')}>Free plan</Label>
          </View>
          <View className="flex-row items-center gap-2">
            <RadioGroupItem value="option-2" accessibilityLabel="Pro plan" />
            <Label onPress={() => setRadioVal('option-2')}>Pro plan</Label>
          </View>
        </RadioGroup>
        <Select value={selectVal} onValueChange={(opt) => setSelectVal(opt)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a framework" />
          </SelectTrigger>
          <SelectContent insets={contentInsets} className="w-full">
            <SelectItem label="React Native" value="rn">
              <SelectItemIcon>
                <Feather name="smartphone" size={16} color={colors.foreground} />
              </SelectItemIcon>
            </SelectItem>
            <SelectItem label="Flutter" value="flutter">
              <SelectItemIcon>
                <Feather name="zap" size={16} color={colors.foreground} />
              </SelectItemIcon>
            </SelectItem>
            <SelectItem label="SwiftUI" value="swift">
              <SelectItemIcon>
                <Feather name="box" size={16} color={colors.foreground} />
              </SelectItemIcon>
            </SelectItem>
            <SelectItem label="React Native for desktop and embedded devices" value="rn-extended">
              <SelectItemIcon>
                <Feather name="monitor" size={16} color={colors.foreground} />
              </SelectItemIcon>
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={regionVal} onValueChange={(opt) => setRegionVal(opt)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a region (long list)" />
          </SelectTrigger>
          <SelectContent className="w-full">
            {LONG_REGIONS.map((region) => (
              <SelectItem key={region} label={region} value={region} />
            ))}
          </SelectContent>
        </Select>
        <View className="flex-row flex-wrap gap-4">
          <Toggle>
            <ToggleText>Bold</ToggleText>
          </Toggle>
          <ToggleGroup type="single">
            <ToggleGroupItem value="left">
              <ToggleGroupItemText>L</ToggleGroupItemText>
            </ToggleGroupItem>
            <ToggleGroupItem value="center">
              <ToggleGroupItemText>C</ToggleGroupItemText>
            </ToggleGroupItem>
            <ToggleGroupItem value="right">
              <ToggleGroupItemText>R</ToggleGroupItemText>
            </ToggleGroupItem>
          </ToggleGroup>
        </View>
      </Section>

      <Section title="Data Row" subtitle="Reusable left/center/right rows with narrow-width safety">
        <View className="rounded-xl border border-border p-3 gap-2">
          <DataRow className="border-b border-border px-1 pb-3">
            <DataRowLeft>
              <Avatar size="sm">
                <AvatarFallback>AL</AvatarFallback>
              </Avatar>
            </DataRowLeft>
            <DataRowCenter>
              <DataRowLabel>Alex Lee</DataRowLabel>
              <DataRowDescription>Lead Product Designer</DataRowDescription>
            </DataRowCenter>
            <DataRowRight>
              <DataRowValue>Owner</DataRowValue>
            </DataRowRight>
          </DataRow>
          <View className="w-64">
            <DataRow size="compact" className="px-1">
              <DataRowLeft>
                <Feather name="activity" size={16} color={colors.muted} />
              </DataRowLeft>
              <DataRowCenter>
                <DataRowLabel>Average Session Duration</DataRowLabel>
                <DataRowDescription>
                  This label truncates safely on narrow screens.
                </DataRowDescription>
              </DataRowCenter>
              <DataRowRight>
                <DataRowValue>12m 48s</DataRowValue>
              </DataRowRight>
            </DataRow>
          </View>
        </View>
      </Section>

      <Section title="OTP Input" subtitle="Verification code entry with auto-focus and paste">
        <OTPInputDemo />
      </Section>
    </View>
  );
}

function OverlaysTab() {
  const { toast } = useToast();
  const [overlaySheetOpen, setOverlaySheetOpen] = useState(false);
  const [overlaySiblingDeleteOpen, setOverlaySiblingDeleteOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const [nestedRegion, setNestedRegion] = useState<SelectOption | undefined>(undefined);

  return (
    <View>
      <Section title="Feedback" subtitle="Alerts, toasts, skeleton, and spinners">
        <Alert className="flex-row items-start">
          <Text className="text-foreground font-bold text-lg mr-3">💡</Text>
          <View className="flex-1">
            <AlertTitle>Design tokens</AlertTitle>
            <AlertDescription>
              Customize every component by editing global.css — no code changes needed.
            </AlertDescription>
          </View>
        </Alert>
        <View className="flex-row flex-wrap gap-2">
          <Button
            variant="outline"
            onPress={() =>
              toast({
                title: 'Saved successfully',
                description: 'Your changes have been applied.',
              })
            }
          >
            <ButtonText>Toast</ButtonText>
          </Button>
          <Button
            variant="outline"
            onPress={() =>
              toast({
                title: 'Deployed!',
                description: 'Your app is now live.',
                variant: 'success',
              })
            }
          >
            <ButtonText>Success</ButtonText>
          </Button>
          <Button
            variant="destructive"
            onPress={() =>
              toast({
                title: 'Build failed',
                description: 'Check the error logs.',
                variant: 'destructive',
              })
            }
          >
            <ButtonText>Error</ButtonText>
          </Button>
        </View>
        <View className="flex-row gap-4 items-center">
          <Spinner size="sm" />
          <Spinner size="lg" className="text-primary" />
        </View>
        <View className="flex-row items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <View className="gap-2 flex-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </View>
        </View>
        <View className="flex-row gap-6 mt-4">
          <View className="flex-1">
            <Text className="mb-2 text-xs text-muted-foreground">pulse</Text>
            <Skeleton variant="pulse" className="h-16 w-full rounded-lg" />
          </View>
          <View className="flex-1">
            <Text className="mb-2 text-xs text-muted-foreground">shimmer</Text>
            <Skeleton variant="shimmer" className="h-16 w-full rounded-lg" />
          </View>
        </View>
      </Section>

      <Section title="Overlays" subtitle="Dialogs, popovers, and menus">
        <View className="flex-row flex-wrap gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">
                <ButtonText>Dialog</ButtonText>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Profile</DialogTitle>
                <DialogDescription>Update your display name and bio.</DialogDescription>
              </DialogHeader>
              <Input placeholder="Display name" className="my-4" />
              <DialogFooter>
                <DialogClose asChild>
                  <Button>
                    <ButtonText>Save</ButtonText>
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <ButtonText>Delete</ButtonText>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove all data. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button variant="outline" onPress={() => setOverlaySheetOpen(true)}>
            <ButtonText>Sheet + native confirm</ButtonText>
          </Button>

          <Modal
            visible={overlaySheetOpen}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={() => setOverlaySheetOpen(false)}
          >
            {/* `className` does nothing on react-native-safe-area-context's SafeAreaView —
                it is a native view Uniwind does not wrap. Styling goes on a child. */}
            <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
              <View className="flex-1 bg-background p-4">
                <View className="flex-row justify-between items-center mb-6">
                  <Text className="text-lg font-semibold text-foreground">Fullscreen sheet</Text>
                  <Button variant="ghost" onPress={() => setOverlaySheetOpen(false)}>
                    <ButtonText>Close</ButtonText>
                  </Button>
                </View>
                <Text className="text-sm text-muted-foreground mb-4">
                  Sibling AlertDialog uses presentation=&quot;native&quot; so confirm appears above
                  this Modal.
                </Text>
                <Button variant="destructive" onPress={() => setOverlaySiblingDeleteOpen(true)}>
                  <ButtonText>Delete item</ButtonText>
                </Button>
              </View>
            </SafeAreaView>
          </Modal>

          <AlertDialog open={overlaySiblingDeleteOpen} onOpenChange={setOverlaySiblingDeleteOpen}>
            <AlertDialogContent presentation="native">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete item?</AlertDialogTitle>
                <AlertDialogDescription>
                  Uses the system alert so it stacks above the sheet Modal.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onPress={() =>
                    toast({ title: 'Deleted', description: 'Confirmed from native alert.' })
                  }
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* The trigger leaves while the sheet is open, so closing has no element to
              return focus to — the case the overlay contract names. */}
          {!nestedOpen && (
            <Button variant="outline" onPress={() => setNestedOpen(true)}>
              <ButtonText>Nested overlays</ButtonText>
            </Button>
          )}
          <Sheet open={nestedOpen} onOpenChange={setNestedOpen} maxHeight="half">
            <SheetHeader
              title="Nested overlays"
              description="A Select and a confirmation inside one sheet."
            />
            <SheetContent>
              <Select value={nestedRegion} onValueChange={setNestedRegion}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a region" />
                </SelectTrigger>
                <SelectContent className="w-full">
                  <SelectItem label="Europe" value="eu" />
                  <SelectItem label="Asia Pacific" value="apac" />
                  <SelectItem label="Americas" value="amer" />
                </SelectContent>
              </Select>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive" className="mt-4 self-start">
                    <ButtonText>Remove region</ButtonText>
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Remove region?</DialogTitle>
                    <DialogDescription>
                      Deployments there stop at the end of the month.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">
                        <ButtonText>Keep</ButtonText>
                      </Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button variant="destructive">
                        <ButtonText>Remove</ButtonText>
                      </Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </SheetContent>
          </Sheet>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary">
                <ButtonText>Popover</ButtonText>
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <Text className="font-medium text-foreground">Layer Settings</Text>
              <Text className="text-sm text-muted-foreground mt-2">
                Adjust opacity, blend mode, and dimensions.
              </Text>
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">
                <ButtonText>Tooltip</ButtonText>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Long press to preview</TooltipContent>
          </Tooltip>
        </View>

        <View className="flex-row flex-wrap gap-2 mt-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <ButtonText>Menu</ButtonText>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Workspace</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Text className="text-foreground">Settings</Text>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Text className="text-foreground">Members</Text>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Text className="text-foreground">Billing</Text>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Text className="text-foreground">API Keys</Text>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ContextMenu>
            <ContextMenuTrigger>
              <View className="border border-dashed border-border p-6 rounded-xl items-center justify-center bg-muted/20">
                <Text className="text-muted-foreground text-sm">Long press for context menu</Text>
              </View>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem>
                <Text className="text-foreground">Copy</Text>
              </ContextMenuItem>
              <ContextMenuItem>
                <Text className="text-foreground">Paste</Text>
              </ContextMenuItem>
              <ContextMenuItem>
                <Text className="text-foreground">Delete</Text>
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </View>
      </Section>

      <OverlayDisclosureDemos />

      <OverlayDataDisplayDemos />
    </View>
  );
}

function OverlayDisclosureDemos() {
  return (
    <Section title="Disclosure" subtitle="Accordions, collapsibles, and tabs">
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>
            <Text className="text-foreground font-medium">Is it fully native?</Text>
          </AccordionTrigger>
          <AccordionContent>
            <Text className="text-muted-foreground">
              Yes. Every component renders native Views, Text, and Pressables — no web views.
            </Text>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>
            <Text className="text-foreground font-medium">Can I customize the theme?</Text>
          </AccordionTrigger>
          <AccordionContent>
            <Text className="text-muted-foreground">
              Yes. All design tokens live in global.css — change one file to redesign everything.
            </Text>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-3">
          <AccordionTrigger>
            <Text className="text-foreground font-medium">Does it support dark mode?</Text>
          </AccordionTrigger>
          <AccordionContent>
            <Text className="text-muted-foreground">
              Yes. Use the theme toggle above to see every component adapt instantly.
            </Text>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <Collapsible className="border border-border rounded-xl p-4 mt-2">
        <View className="flex-row items-center justify-between">
          <Text className="font-semibold text-foreground">What's included</Text>
          <CollapsibleTrigger className="p-2 rounded-lg active:bg-accent">
            <Text className="text-sm font-medium text-primary">Show</Text>
          </CollapsibleTrigger>
        </View>
        <CollapsibleContent className="overflow-hidden">
          <View className="gap-2 mt-3">
            {[
              '34 headless components',
              '31 pre-built blocks',
              'Full theming via design tokens',
            ].map((item) => (
              <View key={item} className="flex-row items-center gap-2 p-2.5 bg-muted rounded-lg">
                <Text className="text-sm text-foreground">{item}</Text>
              </View>
            ))}
          </View>
        </CollapsibleContent>
      </Collapsible>
      <Tabs defaultValue="preview" className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="preview">
            <Text className="text-foreground">Preview</Text>
          </TabsTrigger>
          <TabsTrigger value="code">
            <Text className="text-foreground">Code</Text>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="preview">
          <Card>
            <CardHeader>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>Your workspace is ready.</CardDescription>
            </CardHeader>
            <CardContent className="gap-3">
              <Label>Email</Label>
              <Input placeholder="you@company.com" />
            </CardContent>
            <CardFooter>
              <Button className="w-full">
                <ButtonText>Continue</ButtonText>
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
        <TabsContent value="code">
          <Card>
            <CardContent className="py-6">
              <Text className="text-sm text-muted-foreground font-medium">
                {
                  '<Card>\n  <CardHeader>\n    <CardTitle>Welcome back</CardTitle>\n  </CardHeader>\n  <CardContent>\n    <Input placeholder="..." />\n  </CardContent>\n</Card>'
                }
              </Text>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Section>
  );
}

function OverlayDataDisplayDemos() {
  return (
    <Section title="Data Display" subtitle="Avatars, aspect ratios, and hover cards">
      <View className="flex-row gap-3 items-center">
        {['WU', 'JD', 'MK'].map((initials) => (
          <Avatar key={initials}>
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        ))}
        <View className="w-28">
          <AspectRatio ratio={16 / 9}>
            <View className="flex-1 bg-muted rounded-lg items-center justify-center">
              <Text className="text-xs text-muted-foreground">16:9</Text>
            </View>
          </AspectRatio>
        </View>
      </View>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button variant="link">
            <ButtonText>@whileui (Hover/Press)</ButtonText>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent>
          <View className="flex-row gap-3">
            <Avatar>
              <AvatarFallback>WU</AvatarFallback>
            </Avatar>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-foreground">@whileui</Text>
              <Text className="text-sm text-muted-foreground">
                Beautiful, accessible native components for React Native.
              </Text>
            </View>
          </View>
        </HoverCardContent>
      </HoverCard>
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>
            <Text className="text-foreground text-sm">File</Text>
          </MenubarTrigger>
          <MenubarContent>
            <MenubarLabel>Project</MenubarLabel>
            {['New Project', 'Open'].map((item) => (
              <MenubarItem key={item}>
                <Text className="text-foreground">{item}</Text>
              </MenubarItem>
            ))}
            <MenubarSeparator />
            <MenubarItem>
              <Text className="text-foreground">Export</Text>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        {[
          { label: 'Edit', items: ['Undo', 'Redo'] },
          { label: 'View', items: ['Zoom In', 'Zoom Out'] },
        ].map((menu) => (
          <MenubarMenu key={menu.label}>
            <MenubarTrigger>
              <Text className="text-foreground text-sm">{menu.label}</Text>
            </MenubarTrigger>
            <MenubarContent>
              {menu.items.map((item) => (
                <MenubarItem key={item}>
                  <Text className="text-foreground">{item}</Text>
                </MenubarItem>
              ))}
            </MenubarContent>
          </MenubarMenu>
        ))}
      </Menubar>
    </Section>
  );
}

function OTPInputDemo() {
  const [otp, setOtp] = useState('');
  const [status, setStatus] = useState<'idle' | 'error' | 'success'>('idle');

  return (
    <View className="gap-4">
      <OTPInput
        value={otp}
        onValueChange={(v) => {
          setOtp(v);
          if (status !== 'idle') setStatus('idle');
        }}
        onComplete={(code) => {
          // Stays until the next edit. A timeout here races the native OTP flow.
          setStatus(code === '123456' ? 'success' : 'error');
        }}
        variant={status === 'error' ? 'error' : 'default'}
      />
      <Text
        className={cn(
          'text-center text-sm',
          status === 'error'
            ? 'text-destructive'
            : status === 'success'
              ? 'text-success'
              : 'text-muted-foreground'
        )}
      >
        {status === 'error'
          ? 'Invalid code — try 123456'
          : status === 'success'
            ? 'Code verified!'
            : 'Enter code (try 123456)'}
      </Text>
      <SecurePinDemo />
    </View>
  );
}

function SecurePinDemo() {
  const [pin, setPin] = useState('');
  const [pinOk, setPinOk] = useState(false);

  return (
    <View className="items-center gap-2">
      <Text className="text-xs text-muted-foreground">Secure (4-digit PIN — try 0000)</Text>
      <OTPInput
        length={4}
        secure
        size="compact"
        value={pin}
        onValueChange={(v) => {
          setPin(v);
          setPinOk(false);
        }}
        onComplete={(code) => {
          if (code === '0000') setPinOk(true);
        }}
      />
      {pinOk && <Text className="text-xs text-success">PIN accepted</Text>}
    </View>
  );
}

function FormsBlocksTab() {
  const [email, setEmail] = useState('');
  const [weight, setWeight] = useState<number | null>(72.4);
  const [budget, setBudget] = useState<number | null>(2500);
  const [checkVal, setCheckVal] = useState(false);
  const [switchVal, setSwitchVal] = useState(true);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [dateRangePickerOpen, setDateRangePickerOpen] = useState(false);
  const [selectedRange, setSelectedRange] = useState<DateRange | null>(null);
  const { toast } = useToast();
  const colors = useIconColors();

  const emailInvalid = email.length > 0 && !email.includes('@');

  return (
    <View className="gap-6">
      <Section
        title="Form Controls"
        subtitle="FormField, Input, NumericInput, LabeledField, and compact composition"
      >
        <FormField required invalid={emailInvalid}>
          <FormLabel>Work Email</FormLabel>
          <FormControl>
            <Input
              placeholder="you@company.com"
              value={email}
              onChangeText={setEmail}
              variant={emailInvalid ? 'error' : 'default'}
            />
          </FormControl>
          {emailInvalid ? (
            <FormMessage>Please enter a valid email address.</FormMessage>
          ) : (
            <FormHint>We'll send invoices and account alerts to this email.</FormHint>
          )}
        </FormField>

        <FormField density="compact">
          <FormLabel>Weight</FormLabel>
          <FormControl>
            <NumericInput
              size="compact"
              value={weight}
              min={0}
              max={300}
              step={0.1}
              showSteppers
              onValueChange={setWeight}
              suffix={<Text className="text-xs text-muted-foreground">kg</Text>}
            />
          </FormControl>
          <FormHint>Supports prefix/suffix slots and optional steppers.</FormHint>
        </FormField>

        <LabeledField
          label="Monthly Budget"
          hint="Used for alerts and spending caps"
          leftSlot={<Feather name="dollar-sign" size={16} color={colors.muted} />}
          rightSlot={<Text className="text-xs text-muted-foreground">USD</Text>}
        >
          <LabeledFieldControl>
            <NumericInput value={budget} onValueChange={setBudget} min={0} step={50} unstyled />
          </LabeledFieldControl>
        </LabeledField>

        <FormField>
          <FormLabel>Notes</FormLabel>
          <FormControl>
            <Textarea placeholder="Write something great..." />
          </FormControl>
        </FormField>

        <View className="flex-row items-center gap-6">
          <View className="flex-row items-center gap-2">
            <Checkbox
              checked={checkVal}
              onCheckedChange={setCheckVal}
              accessibilityLabel="Terms & Privacy"
            />
            <Label onPress={() => setCheckVal(!checkVal)}>Terms & Privacy</Label>
          </View>
          <View className="flex-row items-center gap-2">
            <Switch
              checked={switchVal}
              onCheckedChange={setSwitchVal}
              accessibilityLabel="Notify me"
            />
            <Label onPress={() => setSwitchVal(!switchVal)}>Notify me</Label>
          </View>
        </View>
      </Section>

      <Section
        title="Date Picker Modal"
        subtitle="Compact trigger opens bottom sheet with calendar"
      >
        <DatePickerModal
          value={selectedDate}
          onValueChange={(d) => {
            setSelectedDate(d);
            if (d) toast({ title: 'Date selected', description: d });
          }}
          open={datePickerOpen}
          onOpenChange={setDatePickerOpen}
          trigger={<DatePickerTrigger value={selectedDate} placeholder="Pick a date" />}
          title="Select date"
        />
      </Section>

      <Section title="Time Picker Modal" subtitle="Hour and minute wheels in the same sheet">
        <TimePickerModal
          value={selectedTime}
          onValueChange={(t) => {
            setSelectedTime(t);
            if (t) toast({ title: 'Time selected', description: t });
          }}
          open={timePickerOpen}
          onOpenChange={setTimePickerOpen}
          trigger={<TimePickerTrigger value={selectedTime} placeholder="Pick a time" />}
          title="Select time"
        />
      </Section>

      <Section title="Date Picker Inline" subtitle="Embedded calendar for forms or dashboards">
        <DatePickerInline
          value={selectedDate}
          onValueChange={(d) => {
            setSelectedDate(d);
            if (d) toast({ title: 'Date selected', description: d });
          }}
        />
      </Section>

      <Section
        title="Date Range Picker Modal"
        subtitle="Select start and end dates with period marking"
      >
        <DateRangePickerModal
          value={selectedRange}
          onValueChange={(r) => {
            setSelectedRange(r);
            if (r) toast({ title: 'Range selected', description: `${r.start} – ${r.end}` });
          }}
          open={dateRangePickerOpen}
          onOpenChange={setDateRangePickerOpen}
          trigger={<DateRangePickerTrigger value={selectedRange} placeholder="Pick date range" />}
          title="Select date range"
        />
      </Section>

      <Section
        title="Form Modal Screen"
        subtitle="Modal scaffold for forms with header, loading, and saving states"
      >
        <Button onPress={() => setFormModalOpen(true)}>
          <ButtonText>Open Form Modal</ButtonText>
        </Button>
        <Modal
          visible={formModalOpen}
          animationType="slide"
          onRequestClose={() => setFormModalOpen(false)}
        >
          <View style={{ flex: 1 }} className="bg-background">
            <FormModalScreen
              title="Edit Profile"
              subtitle="Update your account details"
              onClose={() => setFormModalOpen(false)}
              saving={formSaving}
              savingText="Saving..."
              scrollEnabled
            >
              <View className="gap-4 pb-8">
                <FormField>
                  <FormLabel>Display Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Jane Doe" />
                  </FormControl>
                </FormField>
                <FormField>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="jane@example.com" keyboardType="email-address" />
                  </FormControl>
                </FormField>
                <FormField>
                  <FormLabel>Bio</FormLabel>
                  <FormControl>
                    <Input placeholder="Tell us about yourself" />
                  </FormControl>
                  <FormHint>Optional. Shown on your public profile.</FormHint>
                </FormField>
                <Button
                  className="mt-2"
                  onPress={() => {
                    setFormSaving(true);
                    setTimeout(() => {
                      setFormSaving(false);
                      toast({ title: 'Profile updated', variant: 'success' });
                      setFormModalOpen(false);
                    }, 1500);
                  }}
                >
                  <ButtonText>Save Changes</ButtonText>
                </Button>
              </View>
            </FormModalScreen>
          </View>
        </Modal>
      </Section>
    </View>
  );
}

function AuthBlocksTab() {
  return (
    <View className="gap-6">
      <Section title="Sign In" subtitle="Email & password authentication">
        <SignInForm />
      </Section>
      <Section title="Sign Up" subtitle="New account registration">
        <SignUpForm />
      </Section>
      <Section title="Forgot Password" subtitle="Password recovery flow">
        <ForgotPasswordForm />
      </Section>
      <Section title="Verify Email" subtitle="OTP verification">
        <VerifyEmailForm />
      </Section>
      <Section title="Reset Password" subtitle="Set a new password">
        <ResetPasswordForm />
      </Section>
      <Section title="Social Login" subtitle="Third-party authentication">
        <SocialConnections />
      </Section>
      <Section title="User Menu" subtitle="Signed-in user dropdown">
        <View className="items-start">
          <UserMenu />
        </View>
      </Section>
    </View>
  );
}

function NavigationBlocksTab() {
  const [activeNav, setActiveNav] = useState('home');
  const [activeTabBar, setActiveTabBar] = useState('all');
  const colors = useIconColors();

  const navItems = [
    {
      key: 'home',
      label: 'Home',
      icon: <Feather name="home" size={22} color={colors.muted} />,
      badge: 3,
    },
    {
      key: 'search',
      label: 'Explore',
      icon: <Feather name="search" size={22} color={colors.muted} />,
    },
    {
      key: 'add',
      label: 'Create',
      icon: <Feather name="plus" size={22} color={colors.muted} />,
    },
    {
      key: 'inbox',
      label: 'Inbox',
      icon: <Feather name="inbox" size={22} color={colors.muted} />,
      badge: 12,
    },
    {
      key: 'profile',
      label: 'Profile',
      icon: <Feather name="user" size={22} color={colors.muted} />,
    },
  ];

  return (
    <View className="gap-6">
      <Section title="Bottom Navigation" subtitle="iOS/Android style tab bar">
        <View className="rounded-xl overflow-hidden border border-border">
          <BottomNav items={navItems} activeKey={activeNav} onSelect={setActiveNav} />
        </View>
      </Section>

      <Section title="Floating Bottom Nav" subtitle="Modern floating pill style">
        <FloatingBottomNav
          items={navItems.slice(0, 4)}
          activeKey={activeNav}
          onSelect={setActiveNav}
        />
      </Section>

      <Section title="Header" subtitle="App header with actions">
        <View className="rounded-xl overflow-hidden border border-border">
          <Header
            title="Settings"
            subtitle="Manage your preferences"
            leftAction={<HeaderBackButton label="Back" />}
            rightActions={[
              {
                key: 'search',
                accessibilityLabel: 'Search',
                icon: <Feather name="search" size={20} color={colors.foreground} />,
                onPress: () => {},
              },
              {
                key: 'more',
                accessibilityLabel: 'More',
                icon: <Feather name="more-horizontal" size={20} color={colors.foreground} />,
                onPress: () => {},
              },
            ]}
          />
        </View>
      </Section>

      <Section title="Tab Bar" subtitle="Content filtering tabs">
        <TabBar items={TAB_BAR_ITEMS} activeKey={activeTabBar} onSelect={setActiveTabBar} />
      </Section>

      <Section title="Tab Bar — Pills" subtitle="Pill-style variant">
        <TabBar
          items={TAB_BAR_ITEMS}
          activeKey={activeTabBar}
          onSelect={setActiveTabBar}
          variant="pills"
        />
      </Section>
    </View>
  );
}

function ChatBlocksTab({
  onBack,
  onMenuPress,
  colors,
}: {
  onBack?: () => void;
  onMenuPress?: () => void;
  colors?: ReturnType<typeof useIconColors>;
}) {
  const fallbackColors = useIconColors();
  const iconColors = colors ?? fallbackColors;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const { toast } = useToast();

  const renderMessage = (message: ChatMessage) => {
    if (message.role !== 'assistant') return <ChatMessageBubble message={message} />;

    return (
      <View className="w-full gap-3">
        <View className="flex-row items-center gap-2">
          <Badge variant="secondary">
            <BadgeText>AI</BadgeText>
          </Badge>
          <Text className="font-semibold text-foreground">Assistant</Text>
        </View>
        <Markdown>{message.content}</Markdown>
        <View className="gap-1 border-l-2 border-border pl-3">
          <Text className="font-medium text-foreground">Reasoning trace</Text>
          <Text className="text-sm text-muted-foreground">
            Reviewed the available primitives and mapped the response into reusable sections.
          </Text>
        </View>
        <CodeBlock
          language="Tool call · searchDocs"
          code={'{ "query": "conversation patterns" }'}
        />
        <View className="flex-row items-center gap-2 border-t border-border pt-3">
          <Feather name="link" size={14} color={iconColors.muted} />
          <Text className="text-sm text-muted-foreground">2 supporting sources</Text>
        </View>
      </View>
    );
  };

  const handleSend = () => {
    if (!inputValue.trim()) return;
    triggerHaptic('medium');
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: inputValue.trim(), secondary: 'Just now' },
    ]);
    setInputValue('');
    toast({ title: 'Sent' });
  };

  return (
    <View style={{ flex: 1 }}>
      <Chat
        messages={messages}
        value={inputValue}
        onChangeText={setInputValue}
        onSend={handleSend}
        placeholder="Message..."
        suggestions={[
          'Summarize this document',
          "Explain like I'm 5",
          'Translate to Spanish',
          'Write a haiku',
        ]}
        onSuggestionPress={(text) => {
          setInputValue(text);
          toast({ title: 'Suggestion selected' });
        }}
        emptyTitle="How can I help?"
        emptyDescription="Ask anything. Supports text, images & attachments."
        exampleMessage={EXAMPLE_CHAT_MESSAGE}
        renderMessage={renderMessage}
        header={
          <View className="flex-row items-center gap-3 border-b border-border bg-background px-4 py-3">
            {onBack && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={onBack}
                className="w-10 h-10 items-center justify-center rounded-xl active:opacity-70 -ml-1"
              >
                <Feather name="arrow-left" size={22} color={iconColors.foreground} />
              </Pressable>
            )}
            <View className="flex-1">
              <Text className="text-lg font-semibold text-foreground">Chat</Text>
              <Text className="text-sm text-muted-foreground">AI conversation</Text>
            </View>
            {onMenuPress && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open menu"
                onPress={onMenuPress}
                className="w-10 h-10 items-center justify-center rounded-xl bg-muted active:opacity-70"
              >
                <Feather name="menu" size={20} color={iconColors.foreground} />
              </Pressable>
            )}
          </View>
        }
        leftSlot={
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel="Attach"
            onPress={() => toast({ title: 'Attach (coming soon)' })}
          >
            <Feather name="paperclip" size={20} color={iconColors.foreground} />
          </Button>
        }
        rightSlot={
          <Button
            size="icon"
            accessibilityLabel="Send"
            disabled={!inputValue.trim()}
            onPress={handleSend}
          >
            <Feather name="send" size={18} color={iconColors.primaryForeground} />
          </Button>
        }
      />
    </View>
  );
}

function CrashableChild() {
  const [shouldCrash, setShouldCrash] = useState(false);
  if (shouldCrash) throw new Error('Demo error: something went wrong!');
  return (
    <Button variant="destructive" onPress={() => setShouldCrash(true)}>
      <ButtonText>Throw error (ErrorBoundary demo)</ButtonText>
    </Button>
  );
}

function LayoutBlocksTab({ onOpenKeyboardScreen }: { onOpenKeyboardScreen: () => void }) {
  const [showLoading, setShowLoading] = useState(false);
  const [shellLoading, setShellLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [smartInputValue, setSmartInputValue] = useState('');
  const { toast } = useToast();
  const colors = useIconColors();

  return (
    <View className="gap-6">
      <Container size="sm" className="border border-dashed border-border rounded-xl p-4 mt-2">
        <Text className="font-semibold text-foreground mb-1">Container — size="sm"</Text>
        <Text className="text-sm text-muted-foreground">
          Caps content width and centres it. Resize the window: on a phone this is a plain
          full-width View, because every size is wider than any phone. On a wide screen it stops the
          line length running away.
        </Text>
      </Container>

      <Container size="lg" className="border border-dashed border-border rounded-xl p-4 mt-2">
        <Text className="font-semibold text-foreground mb-1">Container — size="lg"</Text>
        <Text className="text-sm text-muted-foreground">
          Wider column for dashboards and multi-column content.
        </Text>
      </Container>

      <SectionGroup label="Bars & Overlays" />
      <Section title="Action Bar" subtitle="Sticky bottom action row with safe-area support">
        <ActionBar
          sticky={false}
          safeArea={false}
          className="relative inset-auto rounded-xl border border-border"
        >
          <Button
            variant="outline"
            className="flex-1"
            onPress={() => {
              triggerHaptic('light');
              toast({
                title: 'Changes discarded',
                description: 'ActionBar cancel handler fired.',
              });
            }}
          >
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button
            className="flex-1"
            onPress={() => {
              triggerHaptic('medium');
              toast({
                title: 'Changes saved',
                description: 'ActionBar primary action completed.',
                variant: 'success',
              });
            }}
          >
            <ButtonText>Save Changes</ButtonText>
          </Button>
        </ActionBar>
      </Section>

      <Section
        title="Smart Input"
        subtitle="Screen-owned keyboard handling, a safe-area dock, and rotating examples"
      >
        <Text className="mb-3 text-sm text-muted-foreground">
          The box below is a clip for browsing. The full screen is what the keyboard flows drive.
        </Text>
        <Button
          variant="outline"
          accessibilityLabel="Open keyboard screen"
          testID="open-keyboard-screen"
          onPress={onOpenKeyboardScreen}
          className="mb-4 self-start"
        >
          <ButtonText>Open keyboard screen</ButtonText>
        </Button>
        <KeyboardAwareScreen className="relative h-36 overflow-hidden rounded-xl border border-border">
          <DockedInput safeArea={false}>
            <SmartInput
              variant="card"
              value={smartInputValue}
              onChangeText={setSmartInputValue}
              placeholderExamples={['Plan a morning walk', 'Log two glasses of water']}
              safeArea={false}
              leftSlot={
                <Button
                  variant="ghost"
                  size="icon"
                  accessibilityLabel="Attach"
                  onPress={() => triggerHaptic('light')}
                >
                  <Feather name="plus" size={20} color={colors.foreground} />
                </Button>
              }
              rightSlot={
                <Button
                  size="icon"
                  accessibilityLabel="Send"
                  onPress={() => {
                    triggerHaptic('medium');
                    toast({ title: 'Sent', description: smartInputValue || '(empty)' });
                    setSmartInputValue('');
                  }}
                >
                  <Feather name="send" size={18} color={colors.primaryForeground} />
                </Button>
              }
            />
          </DockedInput>
        </KeyboardAwareScreen>
      </Section>

      <Section
        title="Confirm Action Sheet"
        subtitle="Reusable destructive confirmation sheet with action model"
      >
        <Button variant="destructive" onPress={() => setActionSheetOpen(true)}>
          <ButtonText>Open Confirm Sheet</ButtonText>
        </Button>
        <ConfirmActionSheet
          open={actionSheetOpen}
          onOpenChange={setActionSheetOpen}
          title="Delete workspace?"
          description="This permanently removes projects, members, and billing history."
          actions={[
            { key: 'cancel', label: 'Cancel', variant: 'cancel' },
            {
              key: 'delete',
              label: 'Delete Workspace',
              variant: 'destructive',
              onPress: () => setActionSheetOpen(false),
            },
          ]}
        />
      </Section>

      <Section title="Sheet" subtitle="Bottom sheet modal with header, scrollable content, footer">
        <View className="rounded-xl border border-border p-4 bg-card">
          <Button
            variant="outline"
            onPress={() => setSheetOpen(true)}
            className="w-full"
            testID="open-sheet-test"
          >
            <ButtonText>Open Sheet</ButtonText>
          </Button>
        </View>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen} maxHeight="half">
          <SheetHeader title="Settings" description="Adjust preferences" />
          <SheetContent>
            <View className="gap-4">
              <Text className="text-sm text-muted-foreground">
                Use SheetContent for scrollable body. SheetFooter for actions.
              </Text>
              <View className="h-20 rounded-lg bg-muted items-center justify-center">
                <Text className="text-xs text-muted-foreground">Custom content</Text>
              </View>
              <View className="gap-3">
                <Text className="text-foreground">Account preferences</Text>
                <Text className="text-foreground">Notification preferences</Text>
                <Text className="text-foreground">Privacy preferences</Text>
                <Text className="text-foreground">Language preferences</Text>
                <Text className="text-foreground">Appearance preferences</Text>
                <Text className="text-foreground">Data preferences</Text>
                <Text className="text-foreground">Security preferences</Text>
                <Text className="text-foreground">End of sheet content</Text>
              </View>
            </View>
          </SheetContent>
          <SheetFooter>
            <Button variant="outline" onPress={() => setSheetOpen(false)} testID="close-sheet-test">
              <ButtonText>Cancel</ButtonText>
            </Button>
            <SheetClose asChild>
              <Button onPress={() => triggerHaptic('medium')}>
                <ButtonText>Save</ButtonText>
              </Button>
            </SheetClose>
          </SheetFooter>
        </Sheet>
      </Section>

      <SectionGroup label="Placeholders & Loading" />
      <Section title="Empty State" subtitle="When there's no content to show">
        <Surface padding="none" className="h-64 overflow-hidden">
          <EmptyState
            icon={<Feather name="inbox" size={48} color={colors.muted} />}
            title="No messages yet"
            description="When you receive messages, they'll appear here."
            action={{ label: 'Compose', onPress: () => {} }}
          />
        </Surface>
      </Section>

      <Section title="Error State" subtitle="Something went wrong">
        <Surface padding="none" className="h-64 overflow-hidden">
          <ErrorState
            icon={<Feather name="alert-triangle" size={48} color={colors.destructive} />}
            title="Connection lost"
            description="Check your internet connection and try again."
            onRetry={() => {}}
          />
        </Surface>
      </Section>

      <Section title="Loading State" subtitle="A section still fetching, in flow">
        <Surface padding="none" className="overflow-hidden">
          <LoadingState label="Loading activity" />
        </Surface>
      </Section>

      <LayoutSkeletonDemos />

      <Section
        title="AppShell loading swap"
        subtitle="Keep shell mounted, swap only content with skeleton."
      >
        <View className="gap-3">
          <Button variant="outline" onPress={() => setShellLoading((prev) => !prev)}>
            <ButtonText>{shellLoading ? 'Show Content' : 'Show Skeleton'}</ButtonText>
          </Button>
          <View className="h-80 rounded-xl border border-border overflow-hidden">
            <AppShell
              safeArea={false}
              header={
                <View className="px-4 py-3 border-b border-border bg-card">
                  <Text className="font-medium text-foreground">Settings</Text>
                </View>
              }
              loading={shellLoading}
              skeleton={<PageSkeleton variant="settings" count={5} />}
            >
              <ScrollView className="flex-1 p-4">
                <View className="gap-3">
                  {['Profile', 'Notifications', 'Privacy', 'Billing'].map((item) => (
                    <View key={item} className="rounded-lg border border-border bg-card px-3 py-4">
                      <Text className="text-foreground">{item}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </AppShell>
          </View>
        </View>
      </Section>

      <Section title="Loading Screen" subtitle="Content is being fetched">
        <Button onPress={() => setShowLoading(!showLoading)}>
          <ButtonText>{showLoading ? 'Hide Loading' : 'Show Loading'}</ButtonText>
        </Button>
        {showLoading && (
          <View className="h-32 rounded-xl border border-border overflow-hidden">
            <LoadingScreen message="Fetching data..." size="sm" />
          </View>
        )}
      </Section>

      <SectionGroup label="Infrastructure" />
      <Section title="Error Boundary" subtitle="Catches React errors and renders ErrorState">
        <View className="h-48 rounded-xl border border-border overflow-hidden bg-background">
          <ErrorBoundary>
            <View className="flex-1 items-center justify-center p-4">
              <CrashableChild />
            </View>
          </ErrorBoundary>
        </View>
      </Section>

      <Section title="Pull to Refresh" subtitle="Themed ScrollView + RefreshControl">
        <View className="h-48 rounded-xl border border-border overflow-hidden">
          <PullToRefreshScrollView
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await new Promise((r) => setTimeout(r, 1000));
              setRefreshing(false);
            }}
            className="flex-1"
          >
            <View className="p-4 gap-2">
              <Text className="text-foreground">Pull down to refresh</Text>
              <Text className="text-sm text-muted-foreground">
                Uses useThemeTokens for RefreshControl colors.
              </Text>
            </View>
          </PullToRefreshScrollView>
        </View>
      </Section>
    </View>
  );
}

function LayoutSkeletonDemos() {
  return (
    <>
      <Section
        title="Content Skeleton"
        subtitle="Layout placeholder while loading. Use instead of spinner when you need layout preview."
      >
        <View className="gap-6">
          <View>
            <Text className="mb-2 text-sm text-muted-foreground">Full page preview (list)</Text>
            <View className="min-h-[320px] rounded-xl border border-border overflow-hidden bg-background">
              <ContentSkeleton variant="list" rows={5} className="flex-1" />
            </View>
          </View>
          <View>
            <Text className="mb-2 text-sm text-muted-foreground">Variants</Text>
            <View className="gap-4">
              {(['list', 'card', 'generic'] as const).map((variant) => (
                <View key={variant}>
                  <Text className="mb-1 text-xs text-muted-foreground">{variant}</Text>
                  <View className="rounded-xl border border-border overflow-hidden bg-background">
                    <ContentSkeleton variant={variant} rows={variant === 'list' ? 2 : undefined} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      </Section>
      <Section
        title="Page Skeleton"
        subtitle="Variant-based page layouts: dashboard, list, settings, card, generic."
      >
        <View className="gap-4">
          {(['dashboard', 'list', 'settings', 'card', 'generic'] as const).map((variant) => (
            <View key={variant}>
              <Text className="mb-1 text-xs text-muted-foreground">{variant}</Text>
              <View className="rounded-xl border border-border overflow-hidden bg-background">
                <PageSkeleton
                  variant={variant}
                  count={variant === 'list' ? 5 : variant === 'settings' ? 6 : undefined}
                />
              </View>
            </View>
          ))}
        </View>
      </Section>
      <Section
        title="Screen Skeleton"
        subtitle="Header slot or placeholder plus page content skeleton."
      >
        <View className="gap-4">
          <View className="rounded-xl border border-border overflow-hidden bg-background">
            <ScreenSkeleton variant="list" count={4} headerPlaceholder />
          </View>
          <View className="rounded-xl border border-border overflow-hidden bg-background">
            <ScreenSkeleton
              variant="dashboard"
              header={
                <View className="px-4 pt-4 pb-2 border-b border-border">
                  <Text className="text-base font-medium text-foreground">Overview</Text>
                </View>
              }
            />
          </View>
        </View>
      </Section>
    </>
  );
}

function ProfileBlocksTab() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);
  const colors = useIconColors();

  return (
    <View className="gap-6">
      <Section title="Profile Header" subtitle="User profile with stats">
        <ProfileHeader
          name="Sarah Miller"
          username="sarahmiller"
          bio="Product designer building beautiful interfaces. React Native enthusiast."
          avatarFallback="SM"
          stats={[
            { label: 'Following', value: 234 },
            { label: 'Followers', value: '12.5K' },
            { label: 'Projects', value: 42 },
          ]}
          action={{ label: 'Edit Profile', onPress: () => {} }}
          verified
        />
      </Section>

      <Section title="Account Card" subtitle="Compact user info">
        <AccountCard
          name="Sarah Miller"
          email="sarah@whileui.dev"
          avatarFallback="SM"
          badge="Pro"
        />
      </Section>

      <Section title="Settings" subtitle="Grouped preference controls">
        <SettingsSection title="Preferences">
          <SettingsItem
            icon={<Feather name="bell" size={20} color={colors.muted} />}
            label="Push Notifications"
            type="toggle"
            toggleValue={notificationsEnabled}
            onToggle={setNotificationsEnabled}
          />
          <SettingsItem
            icon={<Feather name="moon" size={20} color={colors.muted} />}
            label="Dark Mode"
            type="toggle"
            toggleValue={darkModeEnabled}
            onToggle={setDarkModeEnabled}
          />
          <SettingsItem
            icon={<Feather name="lock" size={20} color={colors.muted} />}
            label="Privacy"
            value="Public"
          />
          <SettingsItem
            icon={<Feather name="log-out" size={20} color={colors.muted} />}
            label="Sign Out"
            type="action"
            destructive
            showBorder={false}
          />
        </SettingsSection>
      </Section>
    </View>
  );
}

function ListsBlocksTab() {
  const colors = useIconColors();

  return (
    <View className="gap-6">
      <Section title="List Items" subtitle="Standard list rows">
        <View className="rounded-xl overflow-hidden border border-border">
          <ListItem
            icon={<Feather name="mail" size={20} color={colors.muted} />}
            title="Email Notifications"
            subtitle="Receive updates via email"
            rightText="On"
          />
          <ListItem
            icon={<Feather name="smartphone" size={20} color={colors.muted} />}
            title="Push Notifications"
            subtitle="Get notified on your device"
          />
          <ListItem
            icon={<Feather name="volume-2" size={20} color={colors.muted} />}
            title="Sound Effects"
            description="Play sounds for actions and notifications"
            showBorder={false}
          />
        </View>
      </Section>

      <Section title="Notifications" subtitle="Activity feed items">
        <View className="rounded-xl overflow-hidden border border-border">
          <NotificationItem
            avatarFallback="SM"
            title="Sarah Miller"
            message="Starred your component library"
            time="2m ago"
            read={false}
          />
          <NotificationItem
            avatarFallback="TK"
            title="Tom Kang"
            message="Requested access to your workspace"
            time="1h ago"
            read={true}
          />
          <NotificationItem
            icon={<Feather name="award" size={20} color={colors.primary} />}
            title="Milestone reached!"
            message="Your library has 1,000 installs"
            time="2d ago"
            read={true}
          />
        </View>
      </Section>

      <Section title="Loading States" subtitle="Component-level skeleton placeholders">
        <View className="rounded-xl overflow-hidden border border-border">
          <ListItem loading title="" />
          <ListItem loading title="" />
          <ListItem loading title="" showBorder={false} />
        </View>
        <View className="mt-3 rounded-xl overflow-hidden border border-border">
          <NotificationItem loading title="" message="" time="" />
          <NotificationItem loading title="" message="" time="" />
        </View>
      </Section>

      <Section title="Timeline Feed" subtitle="Vertical feed with connecting lines">
        <TimelineFeed
          items={[
            {
              id: '1',
              title: 'Order Placed',
              subtitle: 'Your order has been received',
              time: '10:30 AM',
            },
            {
              id: '2',
              title: 'Processing',
              subtitle: 'We are preparing your order',
              time: '11:15 AM',
            },
            { id: '3', title: 'Shipped', subtitle: 'Your order is on the way', time: '2:45 PM' },
          ]}
        />
      </Section>
    </View>
  );
}

function CommerceBlocksTab() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(true);

  return (
    <View className="gap-6">
      <Section title="Product Cards" subtitle="Vertical and horizontal layouts">
        <View className="flex-row gap-3">
          <View className="flex-1">
            <ProductCard
              title="Wireless Earbuds"
              price="$129"
              originalPrice="$179"
              badge="–28%"
              rating={4.7}
              reviewCount={842}
            />
          </View>
          <View className="flex-1">
            <ProductCard title="Smart Watch" price="$249" rating={4.9} reviewCount={1203} />
          </View>
        </View>
        <ProductCard
          variant="horizontal"
          title="Noise-Cancelling Headphones"
          price="$299"
          rating={4.8}
          reviewCount={2156}
        />
      </Section>

      <Section title="Loading States" subtitle="Component-level skeleton placeholders">
        <View className="flex-row gap-3">
          <View className="flex-1">
            <ProductCard loading title="" price="" />
          </View>
          <View className="flex-1">
            <ProductCard loading title="" price="" />
          </View>
        </View>
        <ProductCard loading variant="horizontal" title="" price="" className="mt-3" />
        <Row gap="md" className="mt-3">
          <MetricCard loading label="" value="" className="flex-1" />
          <MetricCard loading label="" value="" className="flex-1" />
        </Row>
        <SubscriptionCard loading planName="" price="" className="mt-3" />
        <PricingCard loading name="" price="" features={[]} className="mt-3" />
      </Section>

      <Section title="Pricing" subtitle="Subscription plans">
        <PlanToggle
          selected={billingCycle}
          onChange={setBillingCycle}
          annualDiscount="Save 20%"
          className="mb-3"
        />
        <PricingCard
          name="Pro"
          description="For teams and growing products"
          price={billingCycle === 'annual' ? '$24' : '$29'}
          period={billingCycle === 'annual' ? '/month billed yearly' : '/month'}
          badge="Most Popular"
          highlighted
          features={[
            { label: 'Unlimited components', included: true },
            { label: 'Priority support', included: true },
            { label: 'Figma source files', included: true },
            { label: 'Custom themes', included: true },
            { label: 'White-label license', included: false },
          ]}
          onPress={() => {}}
        />
      </Section>

      <Section title="Subscription Card" subtitle="Current plan summary for settings screens">
        <SubscriptionCard
          planName="Pro"
          price="$29"
          period="/month"
          expiresAt="April 18, 2026"
          onManage={() => {}}
          onUpgrade={() => {}}
        />
      </Section>

      {showUpgradeBanner ? (
        <Section title="Upgrade Banner" subtitle="Inline upsell with dismiss action">
          <UpgradeBanner
            message="Unlock unlimited exports and advanced templates with Pro."
            actionLabel="See plans"
            onAction={() => {}}
            onDismiss={() => setShowUpgradeBanner(false)}
          />
        </Section>
      ) : (
        <Section title="Upgrade Banner" subtitle="Inline upsell with dismiss action">
          <Button variant="outline" onPress={() => setShowUpgradeBanner(true)}>
            <ButtonText>Show banner again</ButtonText>
          </Button>
        </Section>
      )}

      <Section title="Usage Bar" subtitle="Usage meter with warning/exceeded states">
        <View className="gap-4">
          <UsageBar label="AI generations today" used={8} limit={20} />
          <UsageBar label="Background removals" used={18} limit={20} />
          <UsageBar label="Video exports" used={25} limit={20} />
        </View>
      </Section>

      <Section title="Checkout" subtitle="Order summary">
        <CheckoutSummary
          items={[
            { label: 'Wireless Earbuds × 1', value: '$129.00' },
            { label: 'Smart Watch × 1', value: '$249.00' },
          ]}
          subtotal="$378.00"
          shipping="Free"
          tax="$30.24"
          discount="$37.80"
          total="$370.44"
          onCheckout={() => {}}
        />
      </Section>

      <Section title="Metric Card" subtitle="Progress bars and segmented stats">
        <Stack gap="md">
          <MetricCard
            label="Total Revenue"
            value="$12,450"
            subtitle="75% of Q1 target"
            progress={75}
          />
          <Row gap="md">
            <MetricCard label="Progress" value="75%" progress={75} className="flex-1" />
            <MetricCard
              label="Distribution"
              value="100%"
              segments={[
                { value: 40, color: '#22c55e' },
                { value: 30, color: '#eab308' },
                { value: 30, color: '#3b82f6' },
              ]}
              className="flex-1"
            />
          </Row>
        </Stack>
      </Section>

      <Section title="Feature Gate" subtitle="Locked feature overlay with upgrade CTA">
        <FeatureGate
          title="Advanced style transfer is locked"
          description="Upgrade to Pro to unlock high-resolution transfer presets."
          buttonLabel="Upgrade to Pro"
          onUpgrade={() => {}}
          icon={<Feather name="lock" size={20} color="#f59e0b" />}
        >
          <View className="h-24 items-center justify-center bg-muted">
            <Text className="text-sm text-muted-foreground">Previewed premium output</Text>
          </View>
        </FeatureGate>
      </Section>

      <Section title="Smart Image" subtitle="expo-image with skeleton loading and fallback">
        <Text variant="caption" className="text-muted-foreground mb-2">
          Skeleton (pulsing) shows while loading. Images may load too fast to see it.
        </Text>
        <View className="flex-row gap-3 mb-3">
          <View className="w-28 h-28 rounded-xl overflow-hidden">
            <Skeleton className="w-full h-full rounded-xl" />
          </View>
          <View className="w-28 h-28 rounded-xl overflow-hidden">
            <Skeleton className="w-full h-full rounded-xl" />
          </View>
        </View>
        <Text variant="caption" className="text-muted-foreground mb-2">
          SmartImage — same size boxes with skeleton while loading.
        </Text>
        <View className="flex-row gap-3">
          <View className="w-28 h-28 rounded-xl overflow-hidden bg-muted">
            <SmartImage
              source={{ uri: 'https://picsum.photos/seed/whileui1/280' }}
              alt="Sample image"
              className="w-full h-full"
            />
          </View>
          <View className="w-28 h-28 rounded-xl overflow-hidden bg-muted">
            <SmartImage
              source={{ uri: 'https://invalid-url-for-fallback-demo' }}
              alt="Fallback demo"
              fallbackSource={{ uri: 'https://picsum.photos/seed/whileui2/280' }}
              className="w-full h-full"
            />
          </View>
        </View>
      </Section>
    </View>
  );
}
