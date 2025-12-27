# Component Library

Reusable UI components located in `frontend/src/components/ui/`. These components provide consistent styling and behavior across the application.

---

## Button

Primary action button with loading states and multiple variants.

**Location:** `components/ui/Button.tsx`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'primary'` \| `'secondary'` \| `'ghost'` \| `'danger'` \| `'glass'` \| `'outline'` | `'primary'` | Visual style |
| `size` | `'sm'` \| `'md'` \| `'lg'` | `'md'` | Button size |
| `icon` | `ReactNode` | - | Optional icon element |
| `loading` | `boolean` | `false` | Show loading spinner |
| `disabled` | `boolean` | `false` | Disable button |
| `children` | `ReactNode` | - | Button label |

### Variants

- **primary**: Blue background, white text, shadow, hover lift effect
- **secondary**: White background, slate border, subtle shadow
- **outline**: Transparent background, slate border
- **ghost**: Transparent, no border, subtle hover background
- **danger**: Red background, white text
- **glass**: Semi-transparent with backdrop blur

### Usage

```tsx
import { Button } from '@/components/ui/Button';
import { Save, Trash } from 'lucide-react';

// Primary button with icon
<Button variant="primary" icon={<Save size={16} />}>
  Save Document
</Button>

// Loading state
<Button loading>Processing...</Button>

// Danger variant
<Button variant="danger" icon={<Trash size={16} />}>
  Delete
</Button>

// Glass variant (for overlays)
<Button variant="glass" size="sm">
  Close
</Button>
```

---

## IconButton

Icon-only button for compact controls. Requires `aria-label` for accessibility.

**Location:** `components/ui/IconButton.tsx`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `ReactNode` | - | **Required.** Icon element |
| `variant` | `'ghost'` \| `'outline'` \| `'solid'` \| `'danger'` | `'ghost'` | Visual style |
| `size` | `'sm'` \| `'md'` \| `'lg'` | `'md'` | Button size |
| `isActive` | `boolean` | `false` | Pressed/active state |
| `loading` | `boolean` | `false` | Show loading spinner |
| `aria-label` | `string` | - | **Required.** Accessible label |

### Usage

```tsx
import { IconButton } from '@/components/ui/IconButton';
import { X, Menu, Settings, Trash } from 'lucide-react';

// Close button
<IconButton icon={<X />} aria-label="Close" variant="ghost" />

// Active toggle
<IconButton
  icon={<Menu />}
  aria-label="Toggle menu"
  isActive={isMenuOpen}
/>

// Danger action
<IconButton
  icon={<Trash />}
  aria-label="Delete"
  variant="danger"
/>

// Solid primary
<IconButton
  icon={<Settings />}
  aria-label="Settings"
  variant="solid"
/>
```

---

## Card

Container component with multiple visual variants.

**Location:** `components/ui/Card.tsx`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default'` \| `'glass'` \| `'elevated'` \| `'glass-elevated'` \| `'outline'` | `'default'` | Visual style |
| `hover` | `boolean` | `false` | Enable hover effects (shadow, lift) |
| `children` | `ReactNode` | - | Card content |
| `className` | `string` | - | Additional CSS classes |

### Variants

- **default**: White background, subtle border and shadow
- **outline**: Transparent, border only
- **glass**: Semi-transparent with backdrop blur
- **elevated**: Stronger shadow, no border
- **glass-elevated**: Glass effect with shadow

### Usage

```tsx
import { Card } from '@/components/ui/Card';

// Default card
<Card className="p-6">
  <h3>Card Title</h3>
  <p>Card content here...</p>
</Card>

// Hoverable card (for lists)
<Card variant="elevated" hover>
  <p>Click me!</p>
</Card>

// Glass card (for overlays)
<Card variant="glass" className="p-4">
  <p>Floating content</p>
</Card>
```

---

## Modal

Dialog modal with animations, backdrop, and keyboard support.

**Location:** `components/ui/Modal.tsx`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | - | **Required.** Controls visibility |
| `onClose` | `() => void` | - | **Required.** Close callback |
| `title` | `string` | - | Modal header title |
| `size` | `'sm'` \| `'md'` \| `'lg'` \| `'xl'` \| `'full'` | `'md'` | Modal width |
| `showCloseButton` | `boolean` | `true` | Show close button in header |
| `children` | `ReactNode` | - | Modal body content |
| `className` | `string` | - | Additional CSS classes |

### Sizes

- **sm**: `max-w-md` (~28rem)
- **md**: `max-w-lg` (~32rem)
- **lg**: `max-w-2xl` (~42rem)
- **xl**: `max-w-4xl` (~56rem)
- **full**: Full width with margin

### Features

- Closes on Escape key
- Closes on backdrop click
- Prevents body scroll when open
- Animated entrance/exit (Framer Motion)

### Usage

```tsx
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

function Example() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Open Modal</Button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Confirm Action"
        size="sm"
      >
        <p>Are you sure you want to proceed?</p>
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary">Confirm</Button>
        </div>
      </Modal>
    </>
  );
}
```

---

## Input

Text input field with label, validation, and icon support.

**Location:** `components/ui/Input.tsx`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Label text above input |
| `icon` | `ReactNode` | - | Icon shown on the left |
| `error` | `string` | - | Error message (shows red styling) |
| `helperText` | `string` | - | Helper text below input |
| `variant` | `'default'` \| `'glass'` | `'default'` | Visual style |
| `onFocusChange` | `(focused: boolean) => void` | - | Focus state callback |

Also accepts all standard `<input>` props.

### Usage

```tsx
import { Input } from '@/components/ui/Input';
import { Search, Mail } from 'lucide-react';

// Basic input
<Input
  label="Email"
  placeholder="Enter your email"
  type="email"
/>

// With icon
<Input
  icon={<Search size={16} />}
  placeholder="Search..."
/>

// With error
<Input
  label="Email"
  error="Invalid email address"
  value="invalid"
/>

// Glass variant (for overlays)
<Input
  variant="glass"
  icon={<Mail size={16} />}
  placeholder="Email"
/>
```

---

## FormSelect

Dropdown select component matching Input styling.

**Location:** `components/ui/FormSelect.tsx`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | - | Label text above select |
| `error` | `string` | - | Error message |
| `helperText` | `string` | - | Helper text below select |
| `variant` | `'default'` \| `'glass'` | `'default'` | Visual style |
| `icon` | `ReactNode` | - | Icon shown on the left |
| `size` | `'sm'` \| `'md'` \| `'lg'` | `'md'` | Select height |

Also accepts all standard `<select>` props.

### Usage

```tsx
import { FormSelect } from '@/components/ui/FormSelect';
import { Filter } from 'lucide-react';

<FormSelect
  label="Category"
  icon={<Filter size={16} />}
>
  <option value="">Select...</option>
  <option value="law">Law</option>
  <option value="decree">Decree</option>
  <option value="code">Code</option>
</FormSelect>

// With error
<FormSelect label="Type" error="Please select a type">
  <option value="">Select...</option>
</FormSelect>
```

---

## Toast

Notification messages with auto-dismiss and animation.

**Location:** `components/ui/Toast.tsx`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `message` | `string` | - | **Required.** Toast message |
| `type` | `'success'` \| `'error'` \| `'info'` \| `'warning'` | - | **Required.** Toast type |
| `isVisible` | `boolean` | - | **Required.** Controls visibility |
| `onClose` | `() => void` | - | **Required.** Close callback |
| `duration` | `number` | `3000` | Auto-dismiss time in ms (0 = no auto-dismiss) |
| `position` | `'top'` \| `'bottom'` | `'bottom'` | Screen position |

### Types

Each type has a distinct icon and color:
- **success**: Green checkmark
- **error**: Red X circle
- **info**: Blue info icon
- **warning**: Amber alert icon

### Usage

```tsx
import { useState } from 'react';
import { Toast } from '@/components/ui/Toast';

function Example() {
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning') => {
    setToast({ visible: true, message, type });
  };

  return (
    <>
      <button onClick={() => showToast('Saved successfully!', 'success')}>
        Save
      </button>

      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast({ ...toast, visible: false })}
        duration={3000}
        position="bottom"
      />
    </>
  );
}
```

---

## Tooltip

Hover tooltip with customizable placement and delay.

**Location:** `components/ui/Tooltip.tsx`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `string` | - | **Required.** Tooltip text |
| `children` | `ReactNode` | - | **Required.** Trigger element |
| `placement` | `'top'` \| `'bottom'` \| `'left'` \| `'right'` | `'top'` | Tooltip position |
| `delay` | `number` | `200` | Show delay in ms |
| `className` | `string` | - | Additional CSS for tooltip |

### Usage

```tsx
import { Tooltip } from '@/components/ui/Tooltip';
import { IconButton } from '@/components/ui/IconButton';
import { Settings } from 'lucide-react';

// Basic tooltip
<Tooltip content="Open settings" placement="bottom">
  <IconButton icon={<Settings />} aria-label="Settings" />
</Tooltip>

// With custom delay
<Tooltip content="Click to copy" delay={500} placement="right">
  <button>Copy</button>
</Tooltip>
```

---

## Skeleton

Loading placeholder component.

**Location:** `components/ui/Skeleton.tsx`

### Usage

```tsx
import { Skeleton } from '@/components/ui/Skeleton';

// Text line skeleton
<Skeleton className="h-4 w-3/4" />

// Card skeleton
<div className="space-y-2">
  <Skeleton className="h-6 w-1/2" />
  <Skeleton className="h-4 w-full" />
  <Skeleton className="h-4 w-5/6" />
</div>

// Avatar skeleton
<Skeleton className="h-10 w-10 rounded-full" />
```

---

## Design Tokens

### Colors

The component library uses a consistent color palette:

| Token | Usage |
|-------|-------|
| `primary-*` | Primary brand color (blue) |
| `slate-*` | Neutral grays |
| `red-*` | Error/danger states |
| `emerald-*` | Success states |
| `amber-*` | Warning states |
| `blue-*` | Info states |

### Transitions

All components use standardized transitions:

```css
transition-all duration-200 ease-smooth-out
```

### Focus States

Consistent focus ring for keyboard navigation:

```css
focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/50
```

### Disabled States

```css
disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none
```

---

## Utility Function

### `cn()` - Class Name Merger

Located at `src/lib/utils.ts`, this utility merges Tailwind classes intelligently:

```tsx
import { cn } from '@/lib/utils';

// Merge classes, later values override earlier ones
<div className={cn(
  'text-sm font-medium',
  isActive && 'text-primary-600',
  className
)} />
```

Uses `clsx` for conditional classes and `tailwind-merge` for proper overrides.

---

## Accessibility Guidelines

1. **IconButton**: Always provide `aria-label`
2. **Modal**: Focuses first element on open, returns focus on close
3. **Toast**: Uses `role="alert"` for screen readers
4. **Input/FormSelect**: Associate labels with inputs
5. **Keyboard**: All interactive elements support keyboard navigation
6. **Focus visible**: All focusable elements have visible focus rings
7. **Touch targets**: Minimum 44px on mobile devices

---

## Dark Mode

All components support dark mode via the `.dark` class on the root element:

```tsx
// Toggle dark mode
document.documentElement.classList.toggle('dark');
```

Components automatically adapt colors, borders, and backgrounds for dark mode.
