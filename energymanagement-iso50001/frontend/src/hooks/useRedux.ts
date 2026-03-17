import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import type { RootState, AppDispatch } from '@/store/store';

/**
 * Typisierter useDispatch – kennt alle Action-Typen.
 */
export const useAppDispatch: () => AppDispatch = useDispatch;

/**
 * Typisierter useSelector – kennt den Store-State.
 */
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
