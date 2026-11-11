import React from 'react';
import { View, Pressable, KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native';
import { Text } from '../../components/text';
import { SmartInput } from '../layout/smart-input';
import { ChatConversation } from './chat-conversation';
import { cn } from '../../lib/cn';
import { useInteractionTokens, withInteractivePressableStyle } from '../../lib/interaction-tokens';
import { useVisualTokens } from '../../lib/visual-tokens';
import { typographyStyle, type TypographyRole } from '../../lib/recipes';
import { tv } from '../../lib/tv';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Secondary text (small, muted) — timestamps, meta. */
  secondary?: string;
  /** Main content size: sm (small), default, lg (big). */
  contentSize?: 'sm' | 'default' | 'lg';
  /** Reserved: attachments, tags. */
}

export interface ChatSuggestionsProps {
  suggestions: string[];
  onSelect: (text: string) => void;
  className?: string;
}

export interface ChatProps {
  messages: ChatMessage[];
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  placeholder?: string;
  suggestions?: string[];
  onSuggestionPress?: (text: string) => void;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  loading?: boolean;
  header?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Example message shown in empty state so users see the bubble UI. */
  exampleMessage?: ChatMessage;
  /** Custom message renderer (markdown, code, images). Falls back to ChatMessageBubble. */
  renderMessage?: (message: ChatMessage) => React.ReactNode;
  /** Shown at bottom when loading (typing indicator). */
  loadingIndicator?: React.ReactNode;
  /** Passed to SmartInput. Use false when Chat is in a contained demo. */
  inputSafeArea?: boolean;
  /** Offset for KeyboardAvoidingView when Chat has a header (e.g. StatusBar + header height). */
  keyboardVerticalOffset?: number;
  className?: string;
  messagesClassName?: string;
}

const CONTENT_SIZE_ROLE: Record<'sm' | 'default' | 'lg', TypographyRole> = {
  sm: 'label',
  default: 'body',
  lg: 'emphasis',
};

const chatMessageBubbleVariants = tv({
  base: '',
  variants: {
    role: {
      user: 'self-end bg-primary',
      assistant: 'self-start bg-muted',
      system: 'self-center bg-muted-soft',
    },
  },
  defaultVariants: { role: 'assistant' },
});

export function ChatMessageBubble({
  message,
  contentClassName,
}: {
  message: ChatMessage;
  contentClassName?: string;
}) {
  const role = message.role === 'system' ? 'system' : message.role;
  const isUser = message.role === 'user';
  const contentRole = CONTENT_SIZE_ROLE[message.contentSize ?? 'default'];
  const visual = useVisualTokens();
  const { width: screenWidth } = useWindowDimensions();
  const ratio =
    role === 'system' ? visual.chatSystemBubbleMaxWidthRatio : visual.chatBubbleMaxWidthRatio;
  const maxWidth = screenWidth * ratio;

  return (
    <View
      accessible
      accessibilityRole="none"
      accessibilityLabel={
        isUser ? 'Your message' : message.role === 'system' ? 'System message' : 'Assistant message'
      }
      className={chatMessageBubbleVariants({ role })}
      style={{
        maxWidth,
        borderRadius: visual.radiusLg,
        paddingHorizontal: visual.controlPaddingXDefault,
        paddingVertical: visual.controlPaddingYDefault,
      }}
    >
      <Text
        className={cn(
          'leading-relaxed',
          isUser ? 'text-primary-foreground' : 'text-foreground',
          contentClassName
        )}
        style={typographyStyle(visual, contentRole)}
      >
        {message.content}
      </Text>
      {message.secondary && (
        <Text
          className={cn('mt-1', isUser ? 'text-primary-foreground-muted' : 'text-muted-foreground')}
          style={typographyStyle(visual, 'caption')}
        >
          {message.secondary}
        </Text>
      )}
    </View>
  );
}

export function ChatSuggestions({ suggestions, onSelect, className }: ChatSuggestionsProps) {
  const visual = useVisualTokens();

  return (
    <View className={cn('flex-row flex-wrap justify-center gap-2 px-4 py-6', className)}>
      {suggestions.map((text) => (
        <Pressable
          key={text}
          onPress={() => onSelect(text)}
          accessibilityRole="button"
          accessibilityLabel={`Suggestion: ${text}`}
          className="rounded-full border-border bg-muted active:bg-muted"
          style={{
            borderWidth: visual.borderWidthHairline,
            paddingHorizontal: visual.controlPaddingXDefault,
            paddingVertical: visual.controlPaddingYSm,
          }}
        >
          <Text className="text-foreground" style={typographyStyle(visual, 'label')}>
            {text}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const EMPTY_SUGGESTIONS: string[] = [];

export function Chat({
  messages,
  value,
  onChangeText,
  onSend,
  placeholder = 'Message...',
  suggestions = EMPTY_SUGGESTIONS,
  onSuggestionPress,
  leftSlot,
  rightSlot,
  loading = false,
  header,
  emptyTitle,
  emptyDescription,
  exampleMessage,
  renderMessage,
  loadingIndicator,
  inputSafeArea = true,
  keyboardVerticalOffset = 0,
  className,
  messagesClassName,
}: ChatProps) {
  const visual = useVisualTokens();
  const emptyTitleTypography = typographyStyle(visual, 'emphasis');
  const emptyDescriptionTypography = typographyStyle(visual, 'label');
  const isEmpty = messages.length === 0;
  const showSuggestions = isEmpty && suggestions.length > 0;

  const defaultRightSlot = rightSlot ?? (
    <ChatSendButton onPress={onSend} disabled={loading || !value.trim()} />
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={{ flex: 1 }}
      className={className}
    >
      {header}
      <ChatConversation
        className={cn('flex-1', messagesClassName)}
        contentContainerStyle={{
          paddingBottom: 8,
          justifyContent: showSuggestions ? 'center' : 'flex-end',
        }}
      >
        {showSuggestions ? (
          <View className="flex-1 justify-center">
            {exampleMessage && (
              <View className="mb-6 px-4">
                {renderMessage ? (
                  renderMessage(exampleMessage)
                ) : (
                  <ChatMessageBubble message={exampleMessage} />
                )}
              </View>
            )}
            {emptyTitle && (
              <Text
                className="mb-1 text-center font-medium text-foreground"
                style={emptyTitleTypography}
              >
                {emptyTitle}
              </Text>
            )}
            {emptyDescription && (
              <Text
                className="mb-4 text-center text-muted-foreground"
                style={emptyDescriptionTypography}
              >
                {emptyDescription}
              </Text>
            )}
            <ChatSuggestions suggestions={suggestions} onSelect={onSuggestionPress ?? (() => {})} />
          </View>
        ) : (
          <View className="gap-3 px-4 pt-4">
            {messages.map((msg) =>
              renderMessage ? (
                <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>
              ) : (
                <ChatMessageBubble key={msg.id} message={msg} />
              )
            )}
            {loading && loadingIndicator && <View className="px-4">{loadingIndicator}</View>}
          </View>
        )}
      </ChatConversation>
      <SmartInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        leftSlot={leftSlot}
        rightSlot={defaultRightSlot}
        editable={!loading}
        safeArea={inputSafeArea}
      />
    </KeyboardAvoidingView>
  );
}

function ChatSendButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const interaction = useInteractionTokens();
  const visual = useVisualTokens();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={disabled ? 'Send (disabled)' : 'Send message'}
      style={withInteractivePressableStyle(
        {
          height: visual.controlHeightDefault,
          width: visual.controlHeightDefault,
        },
        interaction,
        {
          disabled: Boolean(disabled),
          pressedVariant: 'strong',
        }
      )}
      className={cn(
        'items-center justify-center rounded-full',
        disabled ? 'bg-muted' : 'bg-primary'
      )}
    >
      <Text className="text-primary-foreground" style={typographyStyle(visual, 'emphasis')}>
        ↑
      </Text>
    </Pressable>
  );
}
