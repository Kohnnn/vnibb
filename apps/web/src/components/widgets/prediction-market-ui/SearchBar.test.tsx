import { fireEvent, render } from '@testing-library/react';

import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
    it('renders an input with the supplied placeholder', () => {
        const { getByPlaceholderText } = render(
            <SearchBar placeholder="Search markets" onDebouncedChange={() => undefined} />,
        );
        expect(getByPlaceholderText('Search markets')).toBeInTheDocument();
    });

    it('clears the value when the X button is clicked', () => {
        const onChange = jest.fn();
        const { getByLabelText, getByPlaceholderText } = render(
            <SearchBar placeholder="Search" onDebouncedChange={onChange} />,
        );
        const input = getByPlaceholderText('Search') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'trump' } });
        expect(input.value).toBe('trump');
        fireEvent.click(getByLabelText('Clear search'));
        expect(input.value).toBe('');
    });
});